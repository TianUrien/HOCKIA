-- Home v1, step 1: moderation + comment controls, BEFORE comments spread to
-- more surfaces (Figma Home handoff, agreed proposal 11 Oct 2026).
-- Rollback: supabase/rollbacks/20261011150000_moderation_takedown_comment_controls.down.sql
-- Probe:    supabase/tests/security/moderation_takedown_acl.probe.sql (read-only)
--
-- 1. admin_takedown_content: admins soft-delete reported UGC (post, comment,
--    profile comment, feed item), logged in admin_audit_logs, optionally
--    closing the report. Until now admins could only mark reports resolved.
-- 2. Reports can target feed items and profile comments too.
-- 3. user_posts.comments_enabled: the author turns comments off; existing
--    comments stay readable, new ones are refused (Figma H17).
-- 4. delete_post_comment: the post author may delete any comment on their
--    post (H17), as well as the comment's own author.

-- ── 2. report targets
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment', 'profile_comment', 'feed_item']));

-- ── 3. comments switch
ALTER TABLE public.user_posts ADD COLUMN IF NOT EXISTS comments_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.set_post_comments_enabled(p_post_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  UPDATE user_posts SET comments_enabled = p_enabled
  WHERE id = p_post_id AND author_id = v_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post not found');
  END IF;
  RETURN jsonb_build_object('success', true, 'comments_enabled', p_enabled);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_post_comments_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_post_comments_enabled(uuid, boolean) TO authenticated, service_role;

-- create_post_comment: the live body (202604111100_server_side_content_filter)
-- plus the comments_enabled check.
CREATE OR REPLACE FUNCTION public.create_post_comment(p_post_id uuid, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_trimmed TEXT;
  v_comment_id UUID;
  v_post_author UUID;
  v_comments_enabled BOOLEAN;
  v_filter_reason TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT author_id, comments_enabled INTO v_post_author, v_comments_enabled FROM user_posts WHERE id = p_post_id AND deleted_at IS NULL;
  IF v_post_author IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post not found');
  END IF;

  -- The author turned comments off (existing comments stay readable).
  IF NOT v_comments_enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comments are turned off for this post.');
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
$function$;

-- ── 4. the post author may delete comments on their post
CREATE OR REPLACE FUNCTION public.delete_post_comment(p_comment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_owner_id UUID;
  v_post_author UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT c.author_id, up.author_id INTO v_owner_id, v_post_author
  FROM post_comments c
  LEFT JOIN user_posts up ON up.id = c.post_id
  WHERE c.id = p_comment_id AND c.deleted_at IS NULL;

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment not found');
  END IF;

  IF v_owner_id <> v_user_id AND v_post_author IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE post_comments
  SET deleted_at = timezone('utc', now())
  WHERE id = p_comment_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── 1. admin takedown
CREATE OR REPLACE FUNCTION public.admin_takedown_content(
  p_content_type text,
  p_content_id uuid,
  p_report_id uuid DEFAULT NULL,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_found boolean := false;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  CASE p_content_type
    WHEN 'post' THEN
      UPDATE user_posts SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    WHEN 'comment' THEN
      UPDATE post_comments SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    WHEN 'profile_comment' THEN
      UPDATE profile_comments SET status = 'hidden' WHERE id = p_content_id AND status <> 'hidden';
      v_found := FOUND;
    WHEN 'feed_item' THEN
      UPDATE home_feed_items SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    ELSE
      RAISE EXCEPTION 'Unsupported content type: %', p_content_type;
  END CASE;

  IF p_report_id IS NOT NULL THEN
    UPDATE user_reports SET status = 'resolved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_report_id;
  END IF;

  INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'takedown_content', p_content_type, p_content_id,
          jsonb_build_object('report_id', p_report_id, 'admin_note', p_admin_note, 'was_visible', v_found));

  RETURN jsonb_build_object('success', true, 'taken_down', v_found);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_takedown_content(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_takedown_content(text, uuid, uuid, text) TO authenticated, service_role;
