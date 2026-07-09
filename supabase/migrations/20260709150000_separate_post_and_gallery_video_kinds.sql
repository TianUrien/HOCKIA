-- Separate the FIVE video/media product concepts (Tian, 2026-07-09).
--
-- Storage is shared (video → Cloudflare, images → Supabase Storage) but the
-- PRODUCT meaning and the surface differ. `kind` carries the meaning:
--
--   kind='highlight'   recruitment evidence   → Media/Profile + Pulse card
--   kind='full_match'  recruitment evidence   → Media/Profile + Pulse card
--   kind='post'        Home video post        → the Home feed POST only
--   kind='reel'        Gallery video          → the user's Gallery only
--   (gallery photos stay in Supabase Storage / gallery_photos)
--
-- SURFACES ARE FULLY SEPARATE: a Home post video never appears in the Gallery,
-- a Gallery video is never auto-posted, and neither is ever recruitment evidence.
--
-- Previously the Home composer wrote kind='reel', which would have fused the
-- Home-post and Gallery concepts the moment Gallery video shipped. This migration
-- introduces 'post' and reclassifies the existing composer videos.

-- 1. kind gains 'post' (Home video post). 'reel' is now reserved for Gallery.
ALTER TABLE public.player_videos DROP CONSTRAINT IF EXISTS player_videos_kind_check;
ALTER TABLE public.player_videos ADD CONSTRAINT player_videos_kind_check
  CHECK (kind = ANY (ARRAY['highlight'::text, 'full_match'::text, 'reel'::text, 'post'::text]));

COMMENT ON COLUMN public.player_videos.kind IS
  'Product meaning (storage is Cloudflare for all): post = Home video post (feed only); reel = Gallery video (gallery only); highlight / full_match = recruitment evidence (Media/Profile, may surface a video_added Pulse card). Surfaces do not overlap.';

-- 2. Reclassify: every existing kind='reel' row was created by the HOME composer
--    (Gallery video does not exist yet), so they are Home video posts.
UPDATE public.player_videos SET kind = 'post' WHERE kind = 'reel';

-- 3. video_added Pulse cards remain recruitment-only. The existing triggers
--    already fire only for kind IN ('highlight','full_match'), so 'post' and
--    'reel' are both correctly excluded — no trigger change required.

-- 4. A post may only reference a PUBLIC HOME-POST video the author owns.
--    (Was kind='reel'; a Gallery reel must NOT be attachable to a post.)
CREATE OR REPLACE FUNCTION public.create_user_post(p_content text, p_images jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_post_id UUID;
  v_trimmed TEXT;
  v_video_count INT;
  v_duration NUMERIC;
  v_item JSONB;
  v_filter_reason TEXT;
  v_video_id TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_trimmed := trim(coalesce(p_content, ''));

  IF v_trimmed = '' AND (p_images IS NULL OR jsonb_array_length(p_images) = 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add text, a photo, or a video to publish.');
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post content exceeds 2000 character limit');
  END IF;

  IF v_trimmed <> '' THEN
    v_filter_reason := content_check(v_trimmed);
    IF v_filter_reason IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', v_filter_reason);
    END IF;
  END IF;

  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 5 media items allowed');
  END IF;

  IF p_images IS NOT NULL THEN
    v_video_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
    LOOP
      IF v_item ->> 'media_type' = 'video' THEN
        v_video_count := v_video_count + 1;

        IF v_item ? 'video_id' THEN
          v_video_id := v_item ->> 'video_id';
          IF v_video_id IS NULL OR v_video_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid video reference');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM public.player_videos pv
            WHERE pv.id = v_video_id::uuid
              AND pv.user_id = v_user_id
              AND pv.kind = 'post'
              AND pv.visibility = 'public'
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found, not yours, or not a public post video');
          END IF;
        ELSE
          v_duration := (v_item ->> 'duration')::NUMERIC;
          IF v_duration IS NOT NULL AND v_duration > 180 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video must be 3 minutes or less');
          END IF;
        END IF;
      END IF;
    END LOOP;

    IF v_video_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Maximum 1 video per post');
    END IF;
  END IF;

  INSERT INTO user_posts (author_id, content, images)
  VALUES (v_user_id, v_trimmed, p_images)
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('success', true, 'post_id', v_post_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_post(p_post_id uuid, p_content text, p_images jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_trimmed TEXT;
  v_owner_id UUID;
  v_video_count INT;
  v_duration NUMERIC;
  v_item JSONB;
  v_video_id TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT author_id INTO v_owner_id FROM user_posts WHERE id = p_post_id AND deleted_at IS NULL;
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post not found');
  END IF;
  IF v_owner_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  v_trimmed := trim(coalesce(p_content, ''));

  IF v_trimmed = '' AND (p_images IS NULL OR jsonb_array_length(p_images) = 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add text, a photo, or a video to publish.');
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post content exceeds 2000 character limit');
  END IF;

  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 5 media items allowed');
  END IF;

  IF p_images IS NOT NULL THEN
    v_video_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
    LOOP
      IF v_item ->> 'media_type' = 'video' THEN
        v_video_count := v_video_count + 1;
        IF v_item ? 'video_id' THEN
          v_video_id := v_item ->> 'video_id';
          IF v_video_id IS NULL OR v_video_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid video reference');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM public.player_videos pv
            WHERE pv.id = v_video_id::uuid
              AND pv.user_id = v_user_id
              AND pv.kind = 'post'
              AND pv.visibility = 'public'
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found, not yours, or not a public post video');
          END IF;
        ELSE
          v_duration := (v_item ->> 'duration')::NUMERIC;
          IF v_duration IS NOT NULL AND v_duration > 180 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video must be 3 minutes or less');
          END IF;
        END IF;
      END IF;
    END LOOP;

    IF v_video_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Maximum 1 video per post');
    END IF;
  END IF;

  UPDATE user_posts
  SET content = v_trimmed, images = p_images, updated_at = timezone('utc', now())
  WHERE id = p_post_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;
