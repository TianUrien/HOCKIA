-- Home post video → Cloudflare Stream (social reels), separated from recruitment video.
--
-- PRODUCT MODEL (Tian, 2026-07-09) — one Cloudflare video record, `kind` gives meaning:
--   kind='reel'        → Home "Add video" post + Gallery reels (SOCIAL). Renders as the
--                        post itself; must NOT also produce a "New highlight" Pulse card.
--   kind='highlight'   → recruitment/evidence video (Pulse card OK).
--   kind='full_match'  → recruitment/evidence video (Pulse card OK).
--
-- Today a Home post video is a raw MP4 in Supabase Storage (user-posts bucket) referenced by
-- user_posts.images[].url — unsigned, ungated, and played through a fragile lightbox path.
-- This migration lets a post reference a Cloudflare video by id instead.
--
-- 1) kind CHECK gains 'reel'.
-- 2) video_added generator fires ONLY for highlight/full_match → a social reel never becomes a
--    recruitment card (and a post video never double-posts as a Pulse card).
-- 3) create_user_post / update_user_post accept a Cloudflare video item
--    {media_type:'video', video_id:<uuid>} and VALIDATE the video belongs to the author.
--    Legacy {url,thumb_url,duration} items keep working (old posts + old native bundles).

-- ────────────────────────────────────────────────────────────────────
-- 1. kind: add 'reel'
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.player_videos DROP CONSTRAINT IF EXISTS player_videos_kind_check;
ALTER TABLE public.player_videos ADD CONSTRAINT player_videos_kind_check
  CHECK (kind = ANY (ARRAY['highlight'::text, 'full_match'::text, 'reel'::text]));

COMMENT ON COLUMN public.player_videos.kind IS
  'reel = social post / gallery video (renders as the post; no Pulse card). highlight / full_match = recruitment evidence (may surface a video_added Pulse card).';

-- ────────────────────────────────────────────────────────────────────
-- 2. video_added: recruitment kinds only (reels never create a Pulse card)
-- ────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trigger_video_added_feed_update ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_update
  AFTER UPDATE ON public.player_videos
  FOR EACH ROW
  WHEN (
    NEW.status = 'ready' AND NEW.visibility = 'public'
    AND NEW.kind IN ('highlight', 'full_match')
    AND (OLD.status IS DISTINCT FROM 'ready' OR OLD.visibility IS DISTINCT FROM 'public')
  )
  EXECUTE FUNCTION public.generate_video_added_feed_item();

DROP TRIGGER IF EXISTS trigger_video_added_feed_insert ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_insert
  AFTER INSERT ON public.player_videos
  FOR EACH ROW
  WHEN (
    NEW.status = 'ready' AND NEW.visibility = 'public'
    AND NEW.kind IN ('highlight', 'full_match')
  )
  EXECUTE FUNCTION public.generate_video_added_feed_item();

-- ────────────────────────────────────────────────────────────────────
-- 3. Post RPCs accept a Cloudflare video item, validating ownership
-- ────────────────────────────────────────────────────────────────────
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
          -- Cloudflare-backed reel: the author must own the video row.
          -- (Duration is capped by video-create-upload / Cloudflare at 180s for reels.)
          IF NOT EXISTS (
            SELECT 1 FROM public.player_videos pv
            WHERE pv.id = (v_item ->> 'video_id')::uuid
              AND pv.user_id = v_user_id
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found or not yours');
          END IF;
        ELSE
          -- Legacy Supabase-Storage MP4 item (old posts / old native bundles).
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
          IF NOT EXISTS (
            SELECT 1 FROM public.player_videos pv
            WHERE pv.id = (v_item ->> 'video_id')::uuid
              AND pv.user_id = v_user_id
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found or not yours');
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
