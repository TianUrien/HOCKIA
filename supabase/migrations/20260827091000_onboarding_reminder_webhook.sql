-- Audit 2026-08-27: onboarding reminder emails have NEVER been sent.
--
-- 202602200250_onboarding_reminder_system.sql designed the pipeline as
--   pg_cron → enqueue_onboarding_reminders() → onboarding_reminder_queue
--   → database webhook → notify-onboarding-reminder edge function
-- The cron and the queue exist and fill up daily (41 unprocessed rows on prod,
-- Feb → Aug; 0 ever processed), but the webhook trigger was never created —
-- every other *_queue table has one, this one does not, and the edge function
-- shows zero invocations.
--
-- Webhook triggers carry the function URL and an Authorization header, which
-- is why they were created in the dashboard rather than in git. This
-- migration recreates the missing one by COPYING the existing
-- message_digest_queue webhook definition server-side and swapping the table
-- and function names — the header value never leaves the database and never
-- appears in this file. Idempotent: no-op if the trigger already exists.

DO $$
DECLARE
  d text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'onboarding_reminder_queue' AND t.tgname = 'notify-onboarding-reminder'
  ) THEN
    RAISE NOTICE 'notify-onboarding-reminder webhook already present';
    RETURN;
  END IF;

  SELECT pg_get_triggerdef(t.oid) INTO d
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'message_digest_queue' AND t.tgname = 'notify-message-digest';

  IF d IS NULL THEN
    RAISE EXCEPTION 'template webhook trigger notify-message-digest not found';
  END IF;

  d := replace(d, '"notify-message-digest" AFTER INSERT ON public.message_digest_queue',
                  '"notify-onboarding-reminder" AFTER INSERT ON public.onboarding_reminder_queue');
  d := replace(d, '/functions/v1/notify-message-digest', '/functions/v1/notify-onboarding-reminder');

  IF d NOT LIKE '%onboarding_reminder_queue%' OR d NOT LIKE '%notify-onboarding-reminder''%' THEN
    RAISE EXCEPTION 'trigger rewrite did not produce the expected definition';
  END IF;

  EXECUTE d;
END $$;
