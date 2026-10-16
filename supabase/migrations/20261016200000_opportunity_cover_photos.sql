-- Opportunities v2 · cover photos (founder ruling 4, 16 Oct 2026; Figma O4a/O4b 158:426 / 158:506).
-- Rollback: supabase/rollbacks/20261016200000_opportunity_cover_photos.down.sql
-- Probe:    supabase/tests/security/opportunity_cover_photos_acl.probe.sql (read-only)
--
-- 1. Bucket role-covers (public read, images only, 10 MB server-side cap):
--    the publisher uploads under its own folder (<club_id>/<file>) and may
--    replace or delete its own objects; opportunities.cover_url (20261016140000)
--    points at the public URL. Old native clients ignore the column.
-- 2. Moderation through the existing admin takedown flow: a role can be
--    reported (content_type 'opportunity'); an admin takedown of an
--    'opportunity' removes its COVER PHOTO (the role stays open — closing a
--    role is the recruiter's own action), records the prior URL so Restore
--    puts it back within 30 days, and settles the open reports on it.
-- 3. The nightly orphan sweep (enqueue_orphaned_storage_objects) learns the
--    bucket: a cover no role points at for 30 days is queued for deletion
--    (abandoned forms, replaced photos, taken-down photos past restore).
--
-- Every object carries explicit grants (Oct-30 default-ACL rule).

-- ------------------------------------------------------------ 1. bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('role-covers', 'role-covers', true)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
   SET public = true,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp'],
       file_size_limit = 10485760
 WHERE id = 'role-covers';

DROP POLICY IF EXISTS "Public role cover access" ON storage.objects;
CREATE POLICY "Public role cover access"
ON storage.objects FOR SELECT
USING (bucket_id = 'role-covers');

-- Upload only into your own folder: role-covers/<auth.uid()>/<file>.
DROP POLICY IF EXISTS "Publishers upload role covers" ON storage.objects;
CREATE POLICY "Publishers upload role covers"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'role-covers' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Publishers update role covers" ON storage.objects;
CREATE POLICY "Publishers update role covers"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'role-covers' AND owner = (SELECT auth.uid()))
WITH CHECK (bucket_id = 'role-covers' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Publishers delete role covers" ON storage.objects;
CREATE POLICY "Publishers delete role covers"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'role-covers' AND owner = (SELECT auth.uid()));

-- --------------------------------------------- 2. reports + takedown v2
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment', 'video', 'opportunity']));

ALTER TABLE public.content_takedowns DROP CONSTRAINT IF EXISTS content_takedowns_content_type_check;
ALTER TABLE public.content_takedowns ADD CONSTRAINT content_takedowns_content_type_check
  CHECK (content_type IN ('post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment', 'video', 'opportunity'));

CREATE OR REPLACE FUNCTION public.admin_takedown_content(p_content_type text, p_content_id uuid, p_report_id uuid DEFAULT NULL::uuid, p_admin_note text DEFAULT NULL::text, p_notify_author boolean DEFAULT false)
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
    WHEN 'opportunity' THEN
      -- A role's cover photo comes down; the role itself stays as the recruiter left it.
      SELECT cover_url, club_id INTO v_status, v_author FROM opportunities WHERE id = p_content_id;
      IF v_status IS NOT NULL THEN
        UPDATE opportunities SET cover_url = NULL WHERE id = p_content_id;
        v_found := true;
        v_prior := jsonb_build_object('cover_url', v_status);
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
    WHEN 'opportunity' THEN
      -- Only while the recruiter has not chosen another photo since.
      UPDATE opportunities SET cover_url = t.prior->>'cover_url'
       WHERE id = t.content_id AND cover_url IS NULL;
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

CREATE OR REPLACE FUNCTION public.admin_content_preview(p_content_type text, p_content_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    WHEN 'opportunity' THEN
      -- Excerpt = the role title, plus whether a cover photo is on it right now.
      SELECT club_id, title || CASE WHEN cover_url IS NULL THEN ' · no cover photo' ELSE ' · cover photo' END, club_id
        INTO v_author, v_excerpt, v_profile FROM opportunities WHERE id = p_content_id;
      v_context := 'opportunity';
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

-- ------------------------------------------------ 3. orphan sweep
CREATE OR REPLACE FUNCTION public.enqueue_orphaned_storage_objects(p_limit integer DEFAULT 500, p_min_age interval DEFAULT '30 days'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'storage'
AS $function$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  WITH avatar_refs AS (
    SELECT DISTINCT public.extract_storage_path(avatar_url, 'avatars') AS path
    FROM public.profiles
    WHERE avatar_url IS NOT NULL
  ), gallery_refs AS (
    SELECT DISTINCT public.extract_storage_path(photo_url, 'gallery') AS path
    FROM public.gallery_photos
    WHERE photo_url IS NOT NULL
  ), club_refs AS (
    SELECT DISTINCT public.extract_storage_path(file_url, 'club-media') AS path
    FROM public.club_media
    WHERE file_url IS NOT NULL
  ), journey_refs AS (
    SELECT DISTINCT public.extract_storage_path(image_url, 'journey') AS path
    FROM public.career_history
    WHERE image_url IS NOT NULL
  ), cover_refs AS (
    -- A taken-down cover keeps its file for the 30-day restore window: the
    -- takedown's prior URL counts as a reference until it is restored or stale.
    SELECT DISTINCT public.extract_storage_path(cover_url, 'role-covers') AS path
    FROM public.opportunities
    WHERE cover_url IS NOT NULL
    UNION
    SELECT DISTINCT public.extract_storage_path(prior->>'cover_url', 'role-covers') AS path
    FROM public.content_takedowns
    WHERE content_type = 'opportunity' AND restored_at IS NULL
      AND created_at >= timezone('utc', now()) - interval '30 days'
  ), candidate_objects AS (
    SELECT bucket_id, name, reason
    FROM (
      SELECT o.bucket_id, o.name, 'orphaned avatar' AS reason
      FROM storage.objects o
      WHERE o.bucket_id = 'avatars'
        AND o.created_at < timezone('utc', now()) - p_min_age
        AND NOT EXISTS (SELECT 1 FROM avatar_refs ar WHERE ar.path = o.name)
      UNION ALL
      SELECT o.bucket_id, o.name, 'orphaned gallery photo' AS reason
      FROM storage.objects o
      WHERE o.bucket_id = 'gallery'
        AND o.created_at < timezone('utc', now()) - p_min_age
        AND NOT EXISTS (SELECT 1 FROM gallery_refs gr WHERE gr.path = o.name)
      UNION ALL
      SELECT o.bucket_id, o.name, 'orphaned club media' AS reason
      FROM storage.objects o
      WHERE o.bucket_id = 'club-media'
        AND o.created_at < timezone('utc', now()) - p_min_age
        AND NOT EXISTS (SELECT 1 FROM club_refs cr WHERE cr.path = o.name)
      UNION ALL
      SELECT o.bucket_id, o.name, 'orphaned journey image' AS reason
      FROM storage.objects o
      WHERE o.bucket_id = 'journey'
        AND o.created_at < timezone('utc', now()) - p_min_age
        AND NOT EXISTS (SELECT 1 FROM journey_refs jr WHERE jr.path = o.name)
      UNION ALL
      SELECT o.bucket_id, o.name, 'orphaned role cover' AS reason
      FROM storage.objects o
      WHERE o.bucket_id = 'role-covers'
        AND o.created_at < timezone('utc', now()) - p_min_age
        AND NOT EXISTS (SELECT 1 FROM cover_refs cv WHERE cv.path = o.name)
    ) collected
    ORDER BY bucket_id, name
    LIMIT p_limit
  ), inserted AS (
    INSERT INTO public.storage_cleanup_queue (bucket_id, object_path, reason)
    SELECT c.bucket_id, c.name, c.reason
    FROM candidate_objects c
    -- The grace clock starts at FIRST sighting: never touch queued_at on a
    -- re-scan (the nightly reset kept every row perpetually ineligible).
    ON CONFLICT (bucket_id, object_path) WHERE processed_at IS NULL DO UPDATE
      SET reason = EXCLUDED.reason,
          updated_at = timezone('utc', now())
    RETURNING id
  )
  SELECT COUNT(*) INTO inserted_count FROM inserted;

  RETURN COALESCE(inserted_count, 0);
END;
$function$;
