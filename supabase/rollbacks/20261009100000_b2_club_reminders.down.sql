-- ROLLBACK for 20261009100000_b2_club_reminders.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261009100000 --linked
--
-- Before running: set batched_application_emails_since back to NULL first (or
-- run this file, which drops the column) so notify-application sends the
-- immediate per-application email again; redeploy the previous
-- notify-application if the new build was deployed (it reads the column with a
-- fallback, so it keeps working either way).
--
-- The migration redefined no existing function, so there are no previous
-- bodies to restore. This file unschedules the two cron jobs, drops the new
-- functions, tables and switches.
--
-- NOT reverted: the two enum values 'applicants_closing_soon' and
-- 'applicant_last_call' on profile_notification_kind (Postgres cannot drop an
-- enum value). Notifications already written with them are deleted below so
-- clients that no longer know the kinds never meet them; an unused value is
-- harmless.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('club_reminders_hourly', 'club_new_applications');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.run_club_reminders(text);
DROP FUNCTION IF EXISTS public.club_reminder_skip(uuid, date, uuid[]);
DROP FUNCTION IF EXISTS public.club_reminder_finish(uuid, boolean);
DROP FUNCTION IF EXISTS public.club_reminder_claim(uuid, text, text, date, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.club_reminder_candidates(text, timestamptz);

DROP TABLE IF EXISTS public.club_reminder_log;
DROP TABLE IF EXISTS public.club_reminder_batches;

ALTER TABLE public.application_response_settings
  DROP COLUMN IF EXISTS club_reminders_enabled,
  DROP COLUMN IF EXISTS batched_application_emails_since;

DELETE FROM public.profile_notifications
 WHERE kind::text IN ('applicants_closing_soon', 'applicant_last_call');
