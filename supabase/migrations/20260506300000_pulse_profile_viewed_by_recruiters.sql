-- =========================================================================
-- L3 — Profile viewed by recruiters Pulse card
-- =========================================================================
-- Aggregates "club + coach views in the last 7 days" per user, fires at
-- threshold ≥ 1 viewer. Cron runs Monday 13:00 UTC (one hour ahead of the
-- check-in cron, deliberately staggered).
--
-- Coexistence with existing surfaces:
--   - ProfileViewersSection on dashboards (full list view, owner-only) — unchanged
--   - profile_viewed bell-icon notifications via send_profile_view_notifications
--     daily cron — unchanged (per-individual-view granularity)
--   - profile_view_email_digest weekly email — unchanged (email channel)
--
-- This Pulse card is the recruiter-only weekly summary that lives in the
-- in-app feed. Honors a per-user 7-day cooldown via a new column on
-- profiles, mirroring last_profile_view_email_at.
-- =========================================================================

SET search_path = public;

-- =========================================================================
-- 1. Cooldown column on profiles
-- =========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_profile_view_pulse_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.last_profile_view_pulse_at IS
  'Last time a profile_viewed_by_recruiters Pulse card was inserted for this user. Cooldown gate for the weekly aggregator cron.';

-- =========================================================================
-- 2. enqueue_profile_view_pulse_items — fired by pg_cron weekly
-- =========================================================================
-- Per eligible user, counts club + coach views from the last 7 days. If
-- the count is >= 1 and the cooldown has passed, inserts a Pulse card.
-- Eligibility: any role (every role wants to know "someone viewed me"),
-- not test, onboarding completed.
CREATE OR REPLACE FUNCTION public.enqueue_profile_view_pulse_items()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eligible RECORD;
  v_inserted INT := 0;
  v_unique_clubs INT;
  v_unique_coaches INT;
  v_unique_recruiters INT;
  v_top_viewer_role TEXT;
BEGIN
  FOR v_eligible IN
    SELECT p.id, p.role
      FROM public.profiles p
     WHERE COALESCE(p.is_test_account, false) = false
       AND COALESCE(p.onboarding_completed, false) = true
       AND (
         p.last_profile_view_pulse_at IS NULL
         OR p.last_profile_view_pulse_at < timezone('utc', now()) - INTERVAL '7 days'
       )
  LOOP
    -- Count distinct club + coach viewers in the last 7 days, excluding
    -- anonymous browsers, self, and test accounts.
    SELECT
      COUNT(DISTINCT e.user_id) FILTER (WHERE viewer.role = 'club'),
      COUNT(DISTINCT e.user_id) FILTER (WHERE viewer.role = 'coach')
      INTO v_unique_clubs, v_unique_coaches
      FROM public.events e
      INNER JOIN public.profiles viewer ON viewer.id = e.user_id
     WHERE e.event_name = 'profile_view'
       AND e.entity_type = 'profile'
       AND e.entity_id = v_eligible.id
       AND e.created_at >= timezone('utc', now()) - INTERVAL '7 days'
       AND e.user_id IS NOT NULL
       AND e.user_id != v_eligible.id
       AND COALESCE(viewer.is_test_account, false) = false
       AND COALESCE(viewer.browse_anonymously, false) = false
       AND viewer.role IN ('club', 'coach');

    v_unique_recruiters := COALESCE(v_unique_clubs, 0) + COALESCE(v_unique_coaches, 0);

    -- Threshold: only fire when there's at least one recruiter viewer.
    -- Avoids zero-state cards that feel broken.
    IF v_unique_recruiters < 1 THEN
      CONTINUE;
    END IF;

    -- Pick the dominant role for the card copy ("3 clubs viewed your
    -- profile" reads better than "3 recruiters viewed your profile").
    IF COALESCE(v_unique_clubs, 0) >= COALESCE(v_unique_coaches, 0) THEN
      v_top_viewer_role := 'club';
    ELSE
      v_top_viewer_role := 'coach';
    END IF;

    -- Priority 2 — same priority band as celebrations, below the
    -- weekly check-in (P1).
    IF public._insert_pulse_item(
      v_eligible.id,
      'profile_viewed_by_recruiters',
      2::SMALLINT,
      jsonb_build_object(
        'unique_clubs', COALESCE(v_unique_clubs, 0),
        'unique_coaches', COALESCE(v_unique_coaches, 0),
        'unique_recruiters', v_unique_recruiters,
        'top_viewer_role', v_top_viewer_role,
        'window_days', 7
      ),
      7
    ) THEN
      v_inserted := v_inserted + 1;
      UPDATE public.profiles
         SET last_profile_view_pulse_at = timezone('utc', now())
       WHERE id = v_eligible.id;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.enqueue_profile_view_pulse_items IS
  'Cron-driven weekly aggregator. Inserts a profile_viewed_by_recruiters Pulse card per user with at least one club/coach viewer in the last 7 days, gated by a 7-day per-user cooldown.';

REVOKE EXECUTE ON FUNCTION public.enqueue_profile_view_pulse_items() FROM PUBLIC;

-- =========================================================================
-- 3. Schedule via pg_cron — Monday 13:00 UTC (one hour ahead of check-in)
-- =========================================================================
DO $$
BEGIN
  PERFORM cron.unschedule('weekly_profile_view_pulse');
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to unschedule existing cron job';
  WHEN others THEN
    RAISE NOTICE 'No prior weekly_profile_view_pulse schedule found';
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'weekly_profile_view_pulse',
    '0 13 * * 1',
    $cron$SELECT public.enqueue_profile_view_pulse_items();$cron$
  );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to schedule cron job';
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available in this environment';
END;
$$;
