-- Harden the Cloudflare post-video attach path (adversarial review findings).
--
-- 20260709130000 accepted {media_type:'video', video_id} on a post and validated
-- ONLY that the caller owns the video. Two gaps:
--
--  1) kind/visibility unchecked → a user could attach their OWN kind='highlight'
--     video to a post: the same artifact then surfaces BOTH as the post AND as a
--     "New highlight" recruitment Pulse card — the exact double-post the model
--     forbids. Attaching an OWN visibility='recruiters' video to a public post
--     renders a tile that won't play for most viewers (the token fn refuses).
--     Playback was never leakable (video-playback-token is the real gate), but the
--     product model was violable via a direct RPC call.
--     → A post may reference only a PUBLIC REEL the author owns.
--
--  2) (v_item->>'video_id')::uuid raised on malformed input, aborting the RPC with
--     a raw 22P02 instead of the function's JSON error contract.
--     → Validate the uuid shape first and return a clean error.
--
-- Legacy {url, thumb_url, duration} video items are untouched (old posts + old
-- native bundles keep working, incl. the 180s duration cap).

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
          -- Clean error instead of a raw 22P02 cast failure.
          IF v_video_id IS NULL OR v_video_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid video reference');
          END IF;
          -- A post may only carry a PUBLIC REEL owned by the author.
          IF NOT EXISTS (
            SELECT 1 FROM public.player_videos pv
            WHERE pv.id = v_video_id::uuid
              AND pv.user_id = v_user_id
              AND pv.kind = 'reel'
              AND pv.visibility = 'public'
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found, not yours, or not a public reel');
          END IF;
        ELSE
          -- Legacy Supabase-Storage MP4 item.
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
              AND pv.kind = 'reel'
              AND pv.visibility = 'public'
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found, not yours, or not a public reel');
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
