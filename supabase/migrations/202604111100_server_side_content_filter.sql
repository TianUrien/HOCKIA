-- Server-side content filter for posts and comments
-- Prevents bypass of client-side filter via direct API calls
-- Required for Apple Guideline 1.2 compliance

-- ============================================================
-- 1. content_check — reusable filter function
-- ============================================================
CREATE OR REPLACE FUNCTION public.content_check(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN NULL;
  END IF;

  -- Severe slurs and hate speech (mirrors client-side contentFilter.ts)
  IF p_text ~* '\mn[i1]gg[ae3]r'
    OR p_text ~* '\mf[a@]gg[o0]t'
    OR p_text ~* '\mk[i1]ke\M'
    OR p_text ~* '\msp[i1]c\M'
    OR p_text ~* '\mch[i1]nk\M'
    OR p_text ~* '\mwetback'
    OR p_text ~* '\mtr[a@]nn[yi]'
    OR p_text ~* '\mkill\s+(yourself|urself|ur\s*self)'
    OR p_text ~* '\mgo\s+die\M'
    OR p_text ~* '\mI(''ll|.*will)\s+kill\s+(you|u)\M'
  THEN
    RETURN 'Content violates community guidelines.';
  END IF;

  RETURN NULL; -- passes filter
END;
$$;

-- ============================================================
-- 2. Update create_user_post to include content check
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_user_post(
  p_content TEXT,
  p_images JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  v_trimmed := trim(p_content);

  IF v_trimmed = '' OR char_length(v_trimmed) < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post content is required');
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post content exceeds 2000 character limit');
  END IF;

  -- Server-side content filter
  v_filter_reason := content_check(v_trimmed);
  IF v_filter_reason IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_filter_reason);
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
$$;

GRANT EXECUTE ON FUNCTION public.create_user_post(TEXT, JSONB) TO authenticated;

-- ============================================================
-- 3. Update create_post_comment to include content check
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_post_comment(p_post_id UUID, p_content TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_trimmed TEXT;
  v_comment_id UUID;
  v_post_author UUID;
  v_filter_reason TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT author_id INTO v_post_author FROM user_posts WHERE id = p_post_id AND deleted_at IS NULL;
  IF v_post_author IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post not found');
  END IF;

  -- Block check
  IF public.is_blocked_pair(v_user_id, v_post_author) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot interact with this user.');
  END IF;

  v_trimmed := trim(p_content);
  IF v_trimmed = '' OR char_length(v_trimmed) < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment content is required');
  END IF;
  IF char_length(v_trimmed) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment exceeds 500 character limit');
  END IF;

  -- Server-side content filter
  v_filter_reason := content_check(v_trimmed);
  IF v_filter_reason IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_filter_reason);
  END IF;

  INSERT INTO post_comments (post_id, author_id, content) VALUES (p_post_id, v_user_id, v_trimmed) RETURNING id INTO v_comment_id;
  RETURN jsonb_build_object('success', true, 'comment_id', v_comment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_post_comment(UUID, TEXT) TO authenticated;
