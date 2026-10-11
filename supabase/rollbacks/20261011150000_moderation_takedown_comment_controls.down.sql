-- ROLLBACK for 20261011150000_moderation_takedown_comment_controls.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011150000 --linked
--
-- Restores the previous comment functions and report targets, drops the new
-- functions and the comments_enabled column.

DROP FUNCTION IF EXISTS public.admin_takedown_content(text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.set_post_comments_enabled(uuid, boolean);

CREATE OR REPLACE FUNCTION "public"."create_post_comment"("p_post_id" "uuid", "p_content" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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

CREATE OR REPLACE FUNCTION "public"."delete_post_comment"("p_comment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_owner_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT author_id INTO v_owner_id
  FROM post_comments
  WHERE id = p_comment_id AND deleted_at IS NULL;

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment not found');
  END IF;

  IF v_owner_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE post_comments
  SET deleted_at = timezone('utc', now())
  WHERE id = p_comment_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

ALTER TABLE public.user_posts DROP COLUMN IF EXISTS comments_enabled;

DELETE FROM public.user_reports WHERE content_type IN ('profile_comment', 'feed_item');
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment']));
