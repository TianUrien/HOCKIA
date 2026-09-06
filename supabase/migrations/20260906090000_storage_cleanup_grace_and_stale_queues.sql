-- Cross-session review follow-ups (2026-09-06).
--
-- 1. THE BUG (confirmed with cron.job_run_details + queue state): the nightly
--    enqueue_orphaned_storage_objects() ends with
--      ON CONFLICT … DO UPDATE SET queued_at = now()
--    so every still-orphaned object's queue row gets its queued_at RESET each
--    night at 03:30 — and the 04:00 drain requires queued_at older than the
--    7-day grace. Eligible count was permanently 0: the drain has processed
--    nothing since the one manual run on 2026-08-28. The grace clock must
--    start at FIRST sighting, not the latest scan.
--
-- 2. Rows that already failed on ≥1 pre-fix night (attempts > 0) have been
--    orphaned for months — backdate them past the grace so tonight's run
--    drains them. Rows with attempts = 0 keep their date and age naturally
--    (a genuinely new orphan still gets its full grace).
--
-- 3. Dead queue rows that predate their pipelines' fixes are marked
--    processed so nothing can ever mass-send on a replay:
--    - onboarding_reminder_queue: 41 rows from 2026-02-21..08-23, all older
--      than the webhook fix (20260827091000). Their users stalled weeks to
--      months ago; a "finish signing up" email now would be noise. The
--      pipeline is correct for future rows (the edge function sets
--      processed_at; enqueue inserts fire the trigger).
--    - message_digest_queue (4 rows, 2026-03-14) and
--      profile_view_email_queue (8 rows, 2026-03-16): leftovers from before
--      those pipelines' later migrations.

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

DO $$
DECLARE v_n integer;
BEGIN
  -- (2) provably-old orphans become eligible tonight
  UPDATE public.storage_cleanup_queue
     SET queued_at = timezone('utc', now()) - interval '8 days'
   WHERE processed_at IS NULL AND attempts > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'storage rows backdated past grace: %', v_n;

  -- (3) expire dead queue rows — nothing may mass-send on a replay
  UPDATE public.onboarding_reminder_queue
     SET processed_at = timezone('utc', now())
   WHERE processed_at IS NULL AND created_at < '2026-08-27';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'onboarding reminder rows expired (pre-webhook-fix): %', v_n;

  UPDATE public.message_digest_queue
     SET processed_at = timezone('utc', now())
   WHERE processed_at IS NULL AND created_at < '2026-04-01';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'message digest rows expired: %', v_n;

  UPDATE public.profile_view_email_queue
     SET processed_at = timezone('utc', now())
   WHERE processed_at IS NULL AND created_at < '2026-04-01';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'profile view email rows expired: %', v_n;
END $$;
