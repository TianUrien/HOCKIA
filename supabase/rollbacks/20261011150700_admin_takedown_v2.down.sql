-- Rollback for 20261011150700_admin_takedown_v2.sql
DROP FUNCTION IF EXISTS public.admin_content_preview(text, uuid);
DROP FUNCTION IF EXISTS public.admin_restore_content(uuid);
DROP FUNCTION IF EXISTS public.admin_takedown_content(text, uuid, uuid, text, boolean);
DROP TRIGGER IF EXISTS trg_guard_removed_video_status ON public.player_videos;
DROP FUNCTION IF EXISTS public.guard_removed_video_status();

-- Removed videos come back as they were before the takedown (else ready).
UPDATE public.player_videos v
   SET status = COALESCE((SELECT t.prior->>'status' FROM public.content_takedowns t
                           WHERE t.content_type = 'video' AND t.content_id = v.id AND t.restored_at IS NULL
                           ORDER BY t.created_at DESC LIMIT 1), 'ready')
 WHERE v.status = 'removed';
ALTER TABLE public.player_videos DROP CONSTRAINT IF EXISTS player_videos_status_check;
ALTER TABLE public.player_videos ADD CONSTRAINT player_videos_status_check
  CHECK (status = ANY (ARRAY['pending_upload', 'uploaded', 'processing', 'ready', 'errored']));

DELETE FROM public.user_reports WHERE content_type = 'video';
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment']));

DROP TABLE IF EXISTS public.content_takedowns;

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
    WHEN 'feed_item_comment' THEN
      UPDATE feed_item_comments SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    WHEN 'profile_comment' THEN
      UPDATE profile_comments SET status = 'hidden' WHERE id = p_content_id AND status <> 'hidden';
      v_found := FOUND;
    WHEN 'feed_item' THEN
      UPDATE home_feed_items
      SET deleted_at = COALESCE(deleted_at, v_now), metadata = metadata || jsonb_build_object('taken_down', true)
      WHERE id = p_content_id;
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
