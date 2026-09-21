-- Questions fold into the Home feed as a post kind (Figma 03 Player, Home v2 /
-- Compose DEV NOTES, founder ruling 2026-09-20): a question is a user_posts
-- row whose post_type is 'question'. Same author, text, media and visibility
-- rules as a text post; answers are ordinary comments on that post.
--
-- The legacy community_questions / community_answers tables are left
-- untouched — migrating their rows is a separate, reversible step later.

ALTER TABLE public.user_posts DROP CONSTRAINT IF EXISTS user_posts_post_type_check;
ALTER TABLE public.user_posts ADD CONSTRAINT user_posts_post_type_check
  CHECK (post_type IN ('text', 'transfer', 'signing', 'question'));

COMMENT ON COLUMN public.user_posts.post_type IS
  'Post type discriminator: text (default free-text), transfer / signing (club announcements), question (asked in the feed; comments are its answers)';

-- create_user_post gains p_post_type ('text' | 'question'). The old two-argument
-- signature is dropped so PostgREST never sees an ambiguous overload; existing
-- callers pass {p_content, p_images} and get the 'text' default.
DROP FUNCTION IF EXISTS public.create_user_post(text, jsonb);

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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
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

  INSERT INTO user_posts (author_id, content, images, post_type)
  VALUES (v_user_id, v_trimmed, p_images, p_post_type)
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('success', true, 'post_id', v_post_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_user_post(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_user_post(text, jsonb, text) TO authenticated;
