-- Funnel math fix: cumulative-union semantics on the two admin funnel RPCs
-- that the 1k-user audit flagged as producing nonsensical drop-offs.
--
-- Bug (audit IDs 3 + 4 + the activation-funnel half of Bug 4):
--
--   admin_get_onboarding_funnel_detail and admin_get_activation_funnel
--   counted each step INDEPENDENTLY. So a later step could exceed an
--   earlier one (e.g. "browsed_opportunity" > "profile_complete" because
--   browsing doesn't require having a complete profile; or "completed"
--   > "form_submitted" because the form_submitted event is newer than
--   some legacy completed accounts and never fired retroactively).
--
--   The frontend then computed (prev - curr) / prev * 100 and got
--   numbers like -128.6% drop-off (double-minus formatting bug in the
--   UI) or 175% / 400% conversion (capped wrong on the player funnel,
--   which IS independent and gets a separate display fix). The audit
--   recommendation was to "count distinct users who reached each step
--   OR a later step" — i.e. a strict superset chain.
--
-- Fix: each step is now "users who hit this step OR ANY downstream
-- step (or completed onboarding for onb funnel)". The result is
-- monotonically non-increasing so drop-off math is always in [0, 100%].
--
-- player funnel left as-is (admin_get_player_funnel returns ortho-
-- gonal facts: has_avatar / has_video / has_journey_entry are not a
-- funnel — those get a display-side relabel from "% from previous"
-- to "% of total signed up").

SET search_path = public;

-- ── 1. admin_get_onboarding_funnel_detail ────────────────────────────────
-- Steps: signed_up → role_selected → avatar_uploaded → form_submitted → completed
-- A user who ended up onboarding_completed=true implicitly hit all prior
-- steps even if the event was never fired (legacy / pre-instrumentation).
CREATE OR REPLACE FUNCTION public.admin_get_onboarding_funnel_detail(
  p_days INT DEFAULT 30,
  p_role TEXT DEFAULT NULL,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_result JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH signups AS (
    SELECT id, role, created_at, onboarding_completed_at, avatar_url,
      onboarding_completed
    FROM profiles
    WHERE created_at >= v_since
      AND (NOT p_exclude_test OR COALESCE(is_test_account, false) = false)
      AND (p_role IS NULL OR role = p_role)
  ),
  -- One row per user with bool flags for whether they fired each step.
  -- This makes the cumulative-union math straightforward: each step is
  -- "did this step OR any downstream step OR finished onboarding".
  per_user_steps AS (
    SELECT
      e.user_id,
      bool_or(e.properties->>'step' = 'role_selected') AS did_role,
      bool_or(e.properties->>'step' = 'avatar_uploaded') AS did_avatar,
      bool_or(e.properties->>'step' = 'form_submitted') AS did_form
    FROM events e
    WHERE e.event_name = 'onboarding_step'
      AND e.created_at >= v_since
      AND e.user_id IN (SELECT id FROM signups)
    GROUP BY e.user_id
  ),
  -- Join signups to their step-flags. LEFT JOIN so users with no step
  -- events still appear (they only count toward signed_up unless they
  -- also finished onboarding).
  joined AS (
    SELECT
      s.id,
      s.onboarding_completed,
      COALESCE(pus.did_role, false) AS did_role,
      COALESCE(pus.did_avatar, false) AS did_avatar,
      COALESCE(pus.did_form, false) AS did_form
    FROM signups s
    LEFT JOIN per_user_steps pus ON pus.user_id = s.id
  ),
  funnel AS (
    SELECT
      COUNT(*) AS signed_up,
      COUNT(*) FILTER (
        WHERE did_role OR did_avatar OR did_form OR onboarding_completed
      ) AS role_selected,
      COUNT(*) FILTER (
        WHERE did_avatar OR did_form OR onboarding_completed
      ) AS avatar_uploaded,
      COUNT(*) FILTER (
        WHERE did_form OR onboarding_completed
      ) AS form_submitted,
      COUNT(*) FILTER (WHERE onboarding_completed) AS completed
    FROM joined
  ),
  -- Time to completion — unchanged
  completion_times AS (
    SELECT
      role,
      EXTRACT(EPOCH FROM (onboarding_completed_at - created_at)) / 60.0 AS minutes_to_complete
    FROM signups
    WHERE onboarding_completed = true
      AND onboarding_completed_at IS NOT NULL
  ),
  time_stats AS (
    SELECT
      role,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes_to_complete)::numeric, 1) AS median_minutes,
      COUNT(*) AS completed_count
    FROM completion_times
    GROUP BY role
  ),
  -- Stuck users — last_step still uses the LATEST step the user fired,
  -- which is the right semantic for "where are they stuck right now".
  stuck AS (
    SELECT
      s.id AS profile_id,
      s.role,
      s.created_at AS signed_up_at,
      EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400.0 AS days_since_signup,
      CASE
        WHEN EXISTS (SELECT 1 FROM events se WHERE se.user_id = s.id AND se.event_name = 'onboarding_step' AND se.properties->>'step' = 'form_submitted') THEN 'form_submitted'
        WHEN EXISTS (SELECT 1 FROM events se WHERE se.user_id = s.id AND se.event_name = 'onboarding_step' AND se.properties->>'step' = 'avatar_uploaded') THEN 'avatar_uploaded'
        WHEN EXISTS (SELECT 1 FROM events se WHERE se.user_id = s.id AND se.event_name = 'onboarding_step' AND se.properties->>'step' = 'role_selected') THEN 'role_selected'
        ELSE 'signed_up'
      END AS last_step
    FROM signups s
    WHERE s.onboarding_completed = false
      AND s.created_at < NOW() - INTERVAL '24 hours'
    ORDER BY s.created_at DESC
    LIMIT 50
  )
  SELECT jsonb_build_object(
    'funnel', (SELECT row_to_json(f)::jsonb FROM funnel f),
    'time_to_complete', COALESCE((SELECT jsonb_agg(row_to_json(ts)::jsonb) FROM time_stats ts), '[]'::jsonb),
    'stuck_users', COALESCE((SELECT jsonb_agg(row_to_json(st)::jsonb) FROM stuck st), '[]'::jsonb),
    'by_role', (
      SELECT jsonb_object_agg(role, counts) FROM (
        SELECT role, jsonb_build_object(
          'signed_up', COUNT(*),
          'completed', COUNT(*) FILTER (WHERE onboarding_completed = true),
          'completion_rate', CASE WHEN COUNT(*) > 0
            THEN ROUND((COUNT(*) FILTER (WHERE onboarding_completed = true) * 100.0 / COUNT(*))::numeric, 1)
            ELSE 0
          END
        ) AS counts
        FROM signups
        GROUP BY role
      ) sub
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_onboarding_funnel_detail TO authenticated;

-- ── 2. admin_get_activation_funnel ───────────────────────────────────────
-- Steps: signed_up → profile_complete → browsed_opportunity → applied → messaged
-- Each step now counts users who hit this step OR any downstream step.
-- Pre-fix this RPC could show "Browsed Opportunity 175% from Profile
-- Complete" because browsing doesn't require profile-complete in the
-- product, but the UI rendered the ratio as a sequential funnel.
CREATE OR REPLACE FUNCTION public.admin_get_activation_funnel(
  p_days INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_date_filter TIMESTAMPTZ;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_date_filter := CASE
    WHEN p_days IS NULL THEN '-infinity'::TIMESTAMPTZ
    ELSE now() - (p_days || ' days')::INTERVAL
  END;

  WITH cohort AS (
    SELECT id, avatar_url, bio
    FROM profiles
    WHERE NOT is_test_account
      AND created_at > v_date_filter
  ),
  -- Per-user fact flags for the four downstream signals.
  per_user_facts AS (
    SELECT
      c.id,
      (c.avatar_url IS NOT NULL AND c.bio IS NOT NULL AND c.bio <> '') AS has_profile,
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.user_id = c.id AND e.event_name = 'vacancy_view'
      ) AS did_browse,
      EXISTS (
        SELECT 1 FROM opportunity_applications oa WHERE oa.applicant_id = c.id
      ) AS did_apply,
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.user_id = c.id AND e.event_name = 'message_send'
      ) AS did_message
    FROM cohort c
  )
  SELECT json_build_object(
    'signed_up', COUNT(*),
    'profile_complete', COUNT(*) FILTER (
      WHERE has_profile OR did_browse OR did_apply OR did_message
    ),
    'browsed_opportunity', COUNT(*) FILTER (
      WHERE did_browse OR did_apply OR did_message
    ),
    'applied', COUNT(*) FILTER (WHERE did_apply OR did_message),
    'messaged', COUNT(*) FILTER (WHERE did_message)
  ) INTO v_result
  FROM per_user_facts;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_activation_funnel(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
