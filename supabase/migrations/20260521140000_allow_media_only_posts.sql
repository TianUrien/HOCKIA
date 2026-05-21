-- Allow media-only user posts.
--
-- create_user_post / update_user_post rejected any post whose trimmed
-- content was empty ("Post content is required"), forcing users who only
-- want to share a photo or video to type a filler character. A post is
-- valid when it has EITHER text OR at least one media attachment.
--
-- Redefines both RPCs so the content-required check only fires when the
-- text is empty AND there is no media. content is coalesced (defensive),
-- and the content filter is skipped for empty text. Everything else —
-- length cap, media count, video constraints, auth/ownership — unchanged.

CREATE OR REPLACE FUNCTION public.create_user_post(p_content text, p_images jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- A post needs text OR media — media-only posts are allowed.
  IF v_trimmed = ''
     AND (p_images IS NULL OR jsonb_array_length(p_images) = 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add text, a photo, or a video to publish.');
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post content exceeds 2000 character limit');
  END IF;

  -- Server-side content filter — only meaningful when there is text.
  IF v_trimmed <> '' THEN
    v_filter_reason := content_check(v_trimmed);
    IF v_filter_reason IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', v_filter_reason);
    END IF;
  END IF;

  -- Validate media (max 5 items)
  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 5 media items allowed');
  END IF;

  -- Validate video constraints: max 1 video, duration <= 180s
  IF p_images IS NOT NULL THEN
    v_video_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
    LOOP
      IF v_item ->> 'media_type' = 'video' THEN
        v_video_count := v_video_count + 1;
        v_duration := (v_item ->> 'duration')::NUMERIC;
        IF v_duration IS NOT NULL AND v_duration > 180 THEN
          RETURN jsonb_build_object('success', false, 'error', 'Video must be 3 minutes or less');
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  SELECT author_id INTO v_owner_id
  FROM user_posts
  WHERE id = p_post_id AND deleted_at IS NULL;

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post not found');
  END IF;

  IF v_owner_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  v_trimmed := trim(coalesce(p_content, ''));

  -- A post needs text OR media — media-only posts are allowed.
  IF v_trimmed = ''
     AND (p_images IS NULL OR jsonb_array_length(p_images) = 0) THEN
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
        v_duration := (v_item ->> 'duration')::NUMERIC;
        IF v_duration IS NOT NULL AND v_duration > 180 THEN
          RETURN jsonb_build_object('success', false, 'error', 'Video must be 3 minutes or less');
        END IF;
      END IF;
    END LOOP;

    IF v_video_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Maximum 1 video per post');
    END IF;
  END IF;

  UPDATE user_posts
  SET content = v_trimmed,
      images = p_images,
      updated_at = timezone('utc', now())
  WHERE id = p_post_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- The user_posts table also enforced non-empty content with a CHECK
-- constraint (user_posts_content_not_empty: char_length(trim(content)) > 0).
-- Replace it so a row is valid with text OR at least one media item —
-- otherwise the RPC's media-only INSERT/UPDATE is rejected at the table.
ALTER TABLE public.user_posts DROP CONSTRAINT IF EXISTS user_posts_content_not_empty;
ALTER TABLE public.user_posts DROP CONSTRAINT IF EXISTS user_posts_content_or_media;
ALTER TABLE public.user_posts ADD CONSTRAINT user_posts_content_or_media
  CHECK (
    char_length(trim(both from content)) > 0
    OR (images IS NOT NULL AND jsonb_typeof(images) = 'array' AND jsonb_array_length(images) > 0)
  );
