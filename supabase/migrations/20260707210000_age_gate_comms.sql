-- P3 age gate — comms plumbing (final build slice before arming).
--
-- Queue kinds renamed for ops clarity: 'dob_request' (initial enforcement
-- ask) + 'dob_reminder' (day-10 nudge) replace the placeholder pair.
-- The queue is empty on both envs (nothing armed), so the CHECK swap is free.
ALTER TABLE public.age_gate_email_queue
  DROP CONSTRAINT IF EXISTS age_gate_email_queue_kind_check;
ALTER TABLE public.age_gate_email_queue
  ADD CONSTRAINT age_gate_email_queue_kind_check
  CHECK (kind IN ('goodbye', 'welcome_back', 'dob_request', 'dob_reminder'));

-- Day-10 reminder sweep: users whose enforcement clock started ~10 days ago
-- and who still haven't confirmed get exactly one nudge (queue UNIQUE on
-- (profile_id, kind, sweep_date) + the window makes this idempotent daily).
CREATE OR REPLACE FUNCTION public.enqueue_dob_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO age_gate_email_queue (profile_id, kind)
  SELECT p.id, 'dob_reminder'
  FROM profiles p
  WHERE p.role IN ('player', 'coach', 'umpire')
    AND p.date_of_birth IS NULL
    AND p.frozen_minor_at IS NULL
    AND p.dob_required_since IS NOT NULL
    AND p.dob_required_since::date = (timezone('utc', now()))::date - 10
    AND (p.is_test_account = false OR public.is_staging_env())
  ON CONFLICT (profile_id, kind, sweep_date) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_dob_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dob_reminders() TO service_role;

-- Arming helper (run with founder GO): freeze every known minor. Each freeze
-- queues its goodbye row; the drain fn sends the email AND applies the auth
-- ban in the same processing step — freeze arrives WITH the email.
CREATE OR REPLACE FUNCTION public.freeze_known_minors()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id FROM profiles p
    WHERE p.role IN ('player', 'coach', 'umpire')
      AND p.frozen_minor_at IS NULL
      AND p.date_of_birth IS NOT NULL
      AND p.date_of_birth > (timezone('utc', now()))::date - INTERVAL '18 years'
  LOOP
    PERFORM public.freeze_minor_account(r.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.freeze_known_minors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_known_minors() TO service_role;

-- Arming helper: enqueue the enforcement ask for every unknown-age person
-- account. dob_required_since is deliberately NOT set here — the drain fn
-- sets it ON SEND SUCCESS, so the 14-day restriction clock only ever starts
-- for someone the email actually reached (suppressed/failed sends start no
-- clock; those users simply meet the modal at next login).
CREATE OR REPLACE FUNCTION public.enqueue_dob_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO age_gate_email_queue (profile_id, kind)
  SELECT p.id, 'dob_request'
  FROM profiles p
  WHERE p.role IN ('player', 'coach', 'umpire')
    AND p.date_of_birth IS NULL
    AND p.frozen_minor_at IS NULL
    AND p.dob_required_since IS NULL
    AND p.email IS NOT NULL
    AND COALESCE(p.onboarding_completed, false) = true
    AND (p.is_test_account = false OR public.is_staging_env())
  ON CONFLICT (profile_id, kind, sweep_date) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_dob_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dob_requests() TO service_role;

-- Daily reminder cron (inert until dob_required_since values exist).
DO $$
BEGIN
  PERFORM cron.unschedule('age_gate_dob_reminder_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior age_gate_dob_reminder_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule(
    'age_gate_dob_reminder_daily',
    '30 5 * * *',
    $cron$SELECT public.enqueue_dob_reminders();$cron$
  );
END $$;
