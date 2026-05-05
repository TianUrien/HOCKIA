-- =========================================================================
-- L2 — Weekly availability check-in (Loop Layer)
-- =========================================================================
-- The structurally-defining piece: every Monday, eligible users get a
-- Pulse card asking whether they're still open to play / coach / be
-- appointed. One tap confirms → stamps profiles.availability_confirmed_at.
-- Snapshot's "Open to play" signal switches from static-boolean to
-- "boolean AND confirmed within last 60 days" so data stays honest over
-- time without nagging users daily.
--
-- This migration:
--   1. Adds profiles.last_check_in_prompt_at (cooldown column, mirrors
--      profiles.last_profile_view_email_at pattern)
--   2. Adds enqueue_availability_check_ins() — SECURITY DEFINER, runs
--      from pg_cron, inserts one Pulse item per eligible user
--   3. Adds confirm_availability() — SECURITY DEFINER, called by the
--      AvailabilityCheckInCard when the user taps "Yes, still open"
--   4. Schedules the cron at Monday 14:00 UTC (same hour the existing
--      reference reminder cron uses, deliberately staggered ahead of
--      profile-view crons at 03:30/04:00 to spread load)
-- =========================================================================

SET search_path = public;

-- =========================================================================
-- 1. Cooldown column on profiles
-- =========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_check_in_prompt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.last_check_in_prompt_at IS
  'Last time the weekly availability check-in Pulse card was inserted for this user. Cooldown gate for enqueue_availability_check_ins() so the cron does not over-fire if a user is mid-window.';

-- =========================================================================
-- 2. enqueue_availability_check_ins — fired by pg_cron every Monday
-- =========================================================================
-- Inserts one Pulse card per eligible user. Eligibility:
--   - role IN ('player', 'coach', 'umpire') — clubs and brands don't have
--     availability semantics in the v5 plan
--   - NOT is_test_account
--   - onboarding_completed (don't nag mid-onboarding users)
--   - last_check_in_prompt_at IS NULL OR < now() - 6 days
--     (6 not 7 to avoid skipping a week if the cron fires a few seconds
--     before the previous week's stamp)
-- Per-user idempotency belts-and-suspenders: _insert_pulse_item enforces
-- a 7-day per-card-type frequency cap as the second layer.
CREATE OR REPLACE FUNCTION public.enqueue_availability_check_ins()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eligible RECORD;
  v_inserted INT := 0;
  v_state JSONB;
BEGIN
  FOR v_eligible IN
    SELECT
      p.id,
      p.role,
      p.open_to_play,
      p.open_to_coach,
      p.open_to_opportunities,
      p.coach_recruits_for_team
    FROM public.profiles p
    WHERE p.role IN ('player', 'coach', 'umpire')
      AND COALESCE(p.is_test_account, false) = false
      AND COALESCE(p.onboarding_completed, false) = true
      AND (
        p.last_check_in_prompt_at IS NULL
        OR p.last_check_in_prompt_at < timezone('utc', now()) - INTERVAL '6 days'
      )
  LOOP
    -- Snapshot of the current availability state so the card can render
    -- "you said you're open to play — still true?" without an extra fetch.
    v_state := jsonb_build_object(
      'role', v_eligible.role,
      'open_to_play', COALESCE(v_eligible.open_to_play, false),
      'open_to_coach', COALESCE(v_eligible.open_to_coach, false),
      'open_to_opportunities', COALESCE(v_eligible.open_to_opportunities, false),
      'coach_recruits_for_team', COALESCE(v_eligible.coach_recruits_for_team, false)
    );

    -- Priority 1 (highest) — the Loop card always rises to the top of
    -- the user's pulse feed. It's the single most important question we
    -- ask each week.
    IF public._insert_pulse_item(
      v_eligible.id,
      'availability_check_in',
      1::SMALLINT,
      jsonb_build_object('current_state', v_state),
      6
    ) THEN
      v_inserted := v_inserted + 1;
      UPDATE public.profiles
         SET last_check_in_prompt_at = timezone('utc', now())
       WHERE id = v_eligible.id;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.enqueue_availability_check_ins IS
  'Cron-driven weekly check-in enqueue. Inserts one availability_check_in Pulse card per eligible (player/coach/umpire, non-test, onboarded, 6-day cooldown) user. Returns count of inserts for cron observability.';

REVOKE EXECUTE ON FUNCTION public.enqueue_availability_check_ins() FROM PUBLIC;

-- =========================================================================
-- 3. confirm_availability — called by the AvailabilityCheckInCard
-- =========================================================================
-- The user taps "Yes, still open" → this RPC stamps:
--   - availability_confirmed_at (drives the 60-day Snapshot decay)
--   - last_meaningful_update_at (drives future P7 Activity Refresh)
-- Both timestamps are set to NOW() in UTC. Idempotent — calling twice in
-- the same minute is a no-op.
--
-- Caller is identified via auth.uid() so the user can only confirm their
-- own row. SECURITY DEFINER bypasses RLS for the UPDATE; the auth.uid()
-- guard inside the body is the actual gate.
CREATE OR REPLACE FUNCTION public.confirm_availability()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
     SET availability_confirmed_at = timezone('utc', now()),
         last_meaningful_update_at = timezone('utc', now())
   WHERE id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.confirm_availability IS
  'Stamps availability_confirmed_at and last_meaningful_update_at for the calling user. Called by the weekly availability check-in Pulse card when the user confirms they''re still open.';

REVOKE EXECUTE ON FUNCTION public.confirm_availability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_availability() TO authenticated;

-- =========================================================================
-- 4. Schedule via pg_cron — Monday 14:00 UTC
-- =========================================================================
-- Same hour as reference_reminder_emails (proven slot, no Resend collision
-- since this is a Pulse-only card with no email side-effect).
-- Wrapped in DO/EXCEPTION block per the pattern in data_retention.sql:295
-- so re-runs in environments without superuser don't error.
DO $$
BEGIN
  -- Idempotent: drop any prior schedule by name before scheduling, since
  -- cron.schedule is NOT idempotent on jobname.
  PERFORM cron.unschedule('weekly_availability_check_ins');
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to unschedule existing cron job; continuing';
  WHEN others THEN
    RAISE NOTICE 'No prior weekly_availability_check_ins schedule found';
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'weekly_availability_check_ins',
    '0 14 * * 1',
    $cron$SELECT public.enqueue_availability_check_ins();$cron$
  );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to schedule cron job; configure manually in Supabase dashboard';
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available in this environment; skipping schedule';
END;
$$;
