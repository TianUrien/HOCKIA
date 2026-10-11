-- Admin takedown v2 (Figma A1 · Admin reports — takedown, 93:1013).
--
-- * Every takedown is recorded in content_takedowns with what it changed, so
--   "Restore content" undoes exactly that (never a deletion the author made)
--   and only within 30 days.
-- * A takedown resolves EVERY open report on that target, not just one.
-- * Optional neutral notice to the author ("removed for breaking the community
--   rules") — never the reporter, never the admin.
-- * Videos join: status 'removed' (a guard keeps a late Cloudflare webhook
--   from flipping it back), and their Home card goes with them.
-- * admin_content_preview feeds the row's preview line and its removed state.

-- 1. Reports may target a video.
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment', 'video']));

-- 2. Videos can be removed by an admin.
ALTER TABLE public.player_videos DROP CONSTRAINT IF EXISTS player_videos_status_check;
ALTER TABLE public.player_videos ADD CONSTRAINT player_videos_status_check
  CHECK (status = ANY (ARRAY['pending_upload', 'uploaded', 'processing', 'ready', 'errored', 'removed']));

CREATE OR REPLACE FUNCTION public.guard_removed_video_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'removed' AND NEW.status IS DISTINCT FROM 'removed'
     AND COALESCE(current_setting('hockia.restoring_content', true), '') <> 'on' THEN
    NEW.status := 'removed';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_removed_video_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_removed_video_status ON public.player_videos;
CREATE TRIGGER trg_guard_removed_video_status
  BEFORE UPDATE OF status ON public.player_videos
  FOR EACH ROW EXECUTE FUNCTION public.guard_removed_video_status();

-- 3. The record of each takedown.
CREATE TABLE IF NOT EXISTS public.content_takedowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment', 'video')),
  content_id uuid NOT NULL,
  author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  admin_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  prior jsonb NOT NULL DEFAULT '{}'::jsonb,
  notified_author boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  restored_at timestamptz,
  restored_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS content_takedowns_target_idx ON public.content_takedowns (content_type, content_id, created_at DESC);
ALTER TABLE public.content_takedowns ENABLE ROW LEVEL SECURITY;
-- No policies: read and written only through the admin functions below.
REVOKE ALL ON TABLE public.content_takedowns FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.content_takedowns TO service_role;

-- 4. Takedown.
DROP FUNCTION IF EXISTS public.admin_takedown_content(text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.admin_takedown_content(
  p_content_type text,
  p_content_id uuid,
  p_report_id uuid DEFAULT NULL,
  p_admin_note text DEFAULT NULL,
  p_notify_author boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_found boolean := false;
  v_author uuid;
  v_prior jsonb := '{}'::jsonb;
  v_status text;
  v_takedown uuid;
  v_resolved integer := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  CASE p_content_type
    WHEN 'post' THEN
      UPDATE user_posts SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL RETURNING author_id INTO v_author;
      v_found := FOUND;
    WHEN 'comment' THEN
      UPDATE post_comments SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL RETURNING author_id INTO v_author;
      v_found := FOUND;
    WHEN 'feed_item_comment' THEN
      UPDATE feed_item_comments SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL RETURNING author_id INTO v_author;
      v_found := FOUND;
    WHEN 'profile_comment' THEN
      SELECT status::text, author_profile_id INTO v_status, v_author FROM profile_comments WHERE id = p_content_id;
      IF v_status IS NOT NULL AND v_status NOT IN ('hidden', 'deleted') THEN
        UPDATE profile_comments SET status = 'hidden' WHERE id = p_content_id;
        v_found := true;
        v_prior := jsonb_build_object('status', v_status);
      END IF;
    WHEN 'feed_item' THEN
      SELECT author_profile_id INTO v_author FROM home_feed_items WHERE id = p_content_id;
      UPDATE home_feed_items
         SET deleted_at = v_now, metadata = metadata || jsonb_build_object('taken_down', true)
       WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    WHEN 'video' THEN
      SELECT status, user_id INTO v_status, v_author FROM player_videos WHERE id = p_content_id;
      IF v_status IS NOT NULL AND v_status <> 'removed' THEN
        UPDATE player_videos SET status = 'removed', updated_at = v_now WHERE id = p_content_id;
        UPDATE home_feed_items
           SET deleted_at = v_now, metadata = metadata || jsonb_build_object('taken_down', true)
         WHERE item_type = 'video_added' AND metadata->>'video_id' = p_content_id::text AND deleted_at IS NULL;
        v_found := true;
        v_prior := jsonb_build_object('status', v_status);
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported content type: %', p_content_type;
  END CASE;

  IF v_found THEN
    INSERT INTO content_takedowns (content_type, content_id, author_id, admin_id, prior, notified_author, created_at)
    VALUES (p_content_type, p_content_id, v_author, auth.uid(), v_prior, p_notify_author AND v_author IS NOT NULL, v_now)
    RETURNING id INTO v_takedown;

    IF p_notify_author AND v_author IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification(
          v_author, NULL, 'content_removed'::public.profile_notification_kind, v_takedown,
          jsonb_build_object('content_type', p_content_type), NULL
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'content_removed notification failed: %', SQLERRM;
      END;
    END IF;
  END IF;

  -- Every open report on this target is settled by the takedown.
  UPDATE user_reports
     SET status = 'resolved', reviewed_by = auth.uid(), reviewed_at = now()
   WHERE (content_type = p_content_type AND content_id = p_content_id AND status IN ('pending', 'reviewed'))
      OR (p_report_id IS NOT NULL AND id = p_report_id);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'takedown_content', p_content_type, p_content_id,
          jsonb_build_object('report_id', p_report_id, 'admin_note', p_admin_note, 'was_visible', v_found,
                             'takedown_id', v_takedown, 'notified_author', p_notify_author, 'reports_resolved', v_resolved));

  RETURN jsonb_build_object('success', true, 'taken_down', v_found, 'takedown_id', v_takedown, 'reports_resolved', v_resolved);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_takedown_content(text, uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_takedown_content(text, uuid, uuid, text, boolean) TO authenticated, service_role;

-- 5. Restore (30 days). Undoes only what the takedown changed.
CREATE OR REPLACE FUNCTION public.admin_restore_content(p_takedown_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t content_takedowns%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  SELECT * INTO t FROM content_takedowns WHERE id = p_takedown_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Takedown not found');
  END IF;
  IF t.restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already restored');
  END IF;
  IF t.created_at < timezone('utc', now()) - interval '30 days' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Restore is only possible for 30 days');
  END IF;

  CASE t.content_type
    WHEN 'post' THEN
      UPDATE user_posts SET deleted_at = NULL WHERE id = t.content_id AND deleted_at = t.created_at;
    WHEN 'comment' THEN
      UPDATE post_comments SET deleted_at = NULL WHERE id = t.content_id AND deleted_at = t.created_at;
    WHEN 'feed_item_comment' THEN
      UPDATE feed_item_comments SET deleted_at = NULL WHERE id = t.content_id AND deleted_at = t.created_at;
    WHEN 'profile_comment' THEN
      UPDATE profile_comments SET status = (t.prior->>'status')::public.comment_status
       WHERE id = t.content_id AND status = 'hidden';
    WHEN 'feed_item' THEN
      UPDATE home_feed_items SET deleted_at = NULL, metadata = metadata - 'taken_down'
       WHERE id = t.content_id AND deleted_at = t.created_at;
    WHEN 'video' THEN
      UPDATE home_feed_items SET deleted_at = NULL, metadata = metadata - 'taken_down'
       WHERE item_type = 'video_added' AND metadata->>'video_id' = t.content_id::text AND deleted_at = t.created_at;
      PERFORM set_config('hockia.restoring_content', 'on', true);
      UPDATE player_videos SET status = COALESCE(t.prior->>'status', 'ready'), updated_at = timezone('utc', now())
       WHERE id = t.content_id AND status = 'removed';
      PERFORM set_config('hockia.restoring_content', '', true);
  END CASE;

  UPDATE content_takedowns SET restored_at = timezone('utc', now()), restored_by = auth.uid() WHERE id = t.id;
  DELETE FROM profile_notifications WHERE kind = 'content_removed' AND source_entity_id = t.id;

  INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'restore_content', t.content_type, t.content_id, jsonb_build_object('takedown_id', t.id));

  RETURN jsonb_build_object('success', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_restore_content(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_content(uuid) TO authenticated, service_role;

-- 6. The row's preview line: author, excerpt, where it lives, removed state, report count.
CREATE OR REPLACE FUNCTION public.admin_content_preview(p_content_type text, p_content_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_author uuid;
  v_excerpt text;
  v_context text;
  v_post uuid;
  v_profile uuid;
  v_t content_takedowns%ROWTYPE;
  a profiles%ROWTYPE;
  ctx profiles%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  CASE p_content_type
    WHEN 'post' THEN
      SELECT author_id, content, id INTO v_author, v_excerpt, v_post FROM user_posts WHERE id = p_content_id;
      v_context := 'post';
    WHEN 'comment' THEN
      SELECT c.author_id, c.content, c.post_id, up.author_id INTO v_author, v_excerpt, v_post, v_profile
        FROM post_comments c LEFT JOIN user_posts up ON up.id = c.post_id WHERE c.id = p_content_id;
      v_context := 'post_comment';
    WHEN 'feed_item_comment' THEN
      SELECT c.author_id, c.content, h.author_profile_id INTO v_author, v_excerpt, v_profile
        FROM feed_item_comments c LEFT JOIN home_feed_items h ON h.id = c.feed_item_id WHERE c.id = p_content_id;
      v_context := 'reference_comment';
    WHEN 'profile_comment' THEN
      SELECT author_profile_id, content, profile_id INTO v_author, v_excerpt, v_profile FROM profile_comments WHERE id = p_content_id;
      v_context := 'profile_comment';
    WHEN 'feed_item' THEN
      SELECT author_profile_id, COALESCE(metadata->>'endorsement_text', metadata->>'title', item_type), author_profile_id
        INTO v_author, v_excerpt, v_profile FROM home_feed_items WHERE id = p_content_id;
      v_context := 'feed_item';
    WHEN 'video' THEN
      SELECT user_id, title, user_id INTO v_author, v_excerpt, v_profile FROM player_videos WHERE id = p_content_id;
      v_context := 'video';
    ELSE
      RETURN jsonb_build_object('found', false);
  END CASE;

  IF v_author IS NULL AND v_excerpt IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO a FROM profiles WHERE id = v_author;
  SELECT * INTO ctx FROM profiles WHERE id = v_profile;
  SELECT * INTO v_t FROM content_takedowns
   WHERE content_type = p_content_type AND content_id = p_content_id AND restored_at IS NULL
   ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'found', true,
    'author_id', v_author,
    'author_name', a.full_name,
    'author_avatar', a.avatar_url,
    'author_role', a.role,
    'excerpt', left(COALESCE(v_excerpt, ''), 160),
    'context', v_context,
    'post_id', v_post,
    'context_profile_id', v_profile,
    'context_profile_name', ctx.full_name,
    'context_profile_role', ctx.role,
    'report_count', (SELECT count(*) FROM user_reports r WHERE r.content_type = p_content_type AND r.content_id = p_content_id),
    'takedown_id', v_t.id,
    'removed_at', v_t.created_at,
    'removed_by_name', (SELECT full_name FROM profiles WHERE id = v_t.admin_id),
    'restorable', v_t.id IS NOT NULL AND v_t.created_at >= timezone('utc', now()) - interval '30 days'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_content_preview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_content_preview(text, uuid) TO authenticated, service_role;
