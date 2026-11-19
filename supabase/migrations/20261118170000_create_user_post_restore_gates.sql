-- create_user_post: restore the three gates that 20260920180000 dropped.
--
-- 20260920180000_user_posts_question_kind.sql added p_post_type but rewrote
-- the function from the 20260709140000 body, not from 20260710120000 (the
-- pre-production gates). Measured on 2026-11-18 on staging AND production
-- (pg_get_functiondef): no check_rate_limit call, no video_posts_enabled()
-- call, and the video guard asks for kind = 'reel'. Effects:
--   1. Posting has had no rate limit since that migration reached each
--      environment (the 10 posts/hour limit of 20260710120000 is gone again).
--   2. The launch flag no longer gates NEW video items on create: with the
--      flag off (production) a crafted call can still attach a Gallery reel.
--   3. Every video the composer uploads is kind = 'post', so every Home video
--      post is refused ("... not a public reel"), flag on or off. Seen on
--      staging on 2026-11-18 while checking the "Share on Home?" video prompt.
--
-- This migration is the 20260920180000 body (p_post_type, question rules)
-- plus exactly those three pieces, copied from 20260710120000. Nothing else
-- changes. update_user_post was not rewritten and still has its gates.
--
-- Client compatibility: same signature and return shape. Old installed apps
-- call it with {p_content, p_images}; they are affected only by the limit
-- (more than 10 posts in an hour) which they already handle as an error text.
--
-- Rollback: supabase/rollbacks/20261118170000_create_user_post_restore_gates.down.sql
-- Probe: supabase/tests/security/create_user_post_gates.probe.sql (staging only)

CREATE OR REPLACE FUNCTION public.create_user_post(
  p_content text,
  p_images jsonb DEFAULT NULL::jsonb,
  p_post_type text DEFAULT 'text'
)
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
  v_rate_check JSONB;
  v_is_test BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Rate limit: 10 posts/hour, shared 'create_post' pool with the
  -- announcement RPCs. Test accounts exempt (CI/e2e post repeatedly).
  SELECT COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  IF NOT v_is_test THEN
    v_rate_check := public.check_rate_limit(v_user_id::TEXT, 'create_post', 10, 3600);
    IF NOT (v_rate_check ->> 'allowed')::BOOLEAN THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Rate limit exceeded: maximum 10 posts per hour',
        'remaining', (v_rate_check ->> 'remaining')::INT,
        'reset_at', v_rate_check ->> 'reset_at'
      );
    END IF;
  END IF;

  -- Announcements (transfer / signing) have their own RPCs; this one only
  -- writes free-text posts and questions.
  IF p_post_type IS NULL OR p_post_type NOT IN ('text', 'question') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid post type');
  END IF;

  v_trimmed := trim(coalesce(p_content, ''));

  IF v_trimmed = '' AND (p_images IS NULL OR jsonb_array_length(p_images) = 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add text, a photo, or a video to publish.');
  END IF;

  -- A question is its text: media alone is not a question.
  IF p_post_type = 'question' AND v_trimmed = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Write your question first.');
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
          -- Launch flag: NEW Cloudflare video posts only while enabled.
          IF NOT public.video_posts_enabled() THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video posts are not available yet.');
          END IF;

          v_video_id := v_item ->> 'video_id';
          -- Clean error instead of a raw 22P02 cast failure.
          IF v_video_id IS NULL OR v_video_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid video reference');
          END IF;
          -- A post may only carry a PUBLIC HOME POST VIDEO owned by the author
          -- (kind='post'; a Gallery reel or a profile highlight is refused).
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

  INSERT INTO user_posts (author_id, content, images, post_type)
  VALUES (v_user_id, v_trimmed, p_images, p_post_type)
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('success', true, 'post_id', v_post_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_user_post(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_user_post(text, jsonb, text) TO authenticated;
