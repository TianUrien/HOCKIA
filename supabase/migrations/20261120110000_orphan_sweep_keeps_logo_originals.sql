-- Orphan sweep: keep the original of a fitted crest or logo.
--
-- Since the 2026-11-20 founder ruling (docs/design-handoff/decisions.md, "Uploaded
-- photos, crests and logos are formatted by the app") a club crest or brand
-- logo is stored as two files in the avatars bucket: the fitted square that
-- profiles.avatar_url points at (<owner>/<kind>_fit_<stamp>.<ext>) and the
-- picked file kept for a later re-crop (<owner>/<kind>_orig_<stamp>.<ext>).
-- No column points at the second one, so enqueue_orphaned_storage_objects()
-- would queue it for deletion 30 days after upload. avatar_refs now counts the
-- original as in use while its fitted square is in use. An original whose
-- square is no longer referenced (replaced, or an upload that was never saved)
-- is still swept after the usual 30 days, together with the square.
--
-- Nothing else in the function changes (body copied from 20261023130000).
-- The function keeps its grants (service_role only). No client depends on it:
-- only the nightly cron calls it.
--
-- Rollback: supabase/rollbacks/20261120110000_orphan_sweep_keeps_logo_originals.down.sql

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
    UNION
    -- The full-shape profile photo (20261023120000) is in use too.
    SELECT DISTINCT public.extract_storage_path(avatar_full_url, 'avatars') AS path
    FROM public.profiles
    WHERE avatar_full_url IS NOT NULL
    UNION
    -- The picked file kept next to a fitted crest or logo (client
    -- lib/orgImage.ts): <owner>/<kind>_fit_<stamp>.<ext> in avatar_url keeps
    -- <owner>/<kind>_orig_<stamp>.<ext> in use too.
    SELECT DISTINCT regexp_replace(
             public.extract_storage_path(avatar_url, 'avatars'),
             '/(crest|logo)_fit_([0-9]+\.[A-Za-z]+)$', '/\1_orig_\2') AS path
    FROM public.profiles
    WHERE avatar_url IS NOT NULL
      AND public.extract_storage_path(avatar_url, 'avatars') ~ '/(crest|logo)_fit_[0-9]+\.[A-Za-z]+$'
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
