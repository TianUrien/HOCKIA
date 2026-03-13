-- Onboarding Funnel Detail RPC
-- Step-by-step drop-off analysis for the onboarding flow

CREATE OR REPLACE FUNCTION admin_get_onboarding_funnel_detail(
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
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
  -- All users who signed up in the period
  signups AS (
    SELECT id, role, created_at, onboarding_completed_at, avatar_url,
      onboarding_completed
    FROM profiles
    WHERE created_at >= v_since
      AND id NOT IN (SELECT id FROM test_ids)
      AND (p_role IS NULL OR role = p_role)
  ),
  -- Step counts from events table
  step_events AS (
    SELECT
      e.user_id,
      e.properties->>'step' AS step_name,
      MIN(e.created_at) AS step_at
    FROM events e
    WHERE e.event_name = 'onboarding_step'
      AND e.created_at >= v_since
      AND e.user_id NOT IN (SELECT id FROM test_ids)
      AND (p_role IS NULL OR e.role = p_role)
    GROUP BY e.user_id, e.properties->>'step'
  ),
  -- Funnel counts
  funnel AS (
    SELECT
      (SELECT COUNT(*) FROM signups) AS signed_up,
      (SELECT COUNT(DISTINCT user_id) FROM step_events WHERE step_name = 'role_selected') AS role_selected,
      (SELECT COUNT(DISTINCT user_id) FROM step_events WHERE step_name = 'avatar_uploaded') AS avatar_uploaded,
      (SELECT COUNT(DISTINCT user_id) FROM step_events WHERE step_name = 'form_submitted') AS form_submitted,
      (SELECT COUNT(*) FROM signups WHERE onboarding_completed = true) AS completed
  ),
  -- Time to completion
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
  -- Stuck users (signed up but not completed, older than 24 hours)
  stuck AS (
    SELECT
      s.id AS profile_id,
      s.role,
      s.created_at AS signed_up_at,
      EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400.0 AS days_since_signup,
      CASE
        WHEN EXISTS (SELECT 1 FROM step_events se WHERE se.user_id = s.id AND se.step_name = 'form_submitted') THEN 'form_submitted'
        WHEN EXISTS (SELECT 1 FROM step_events se WHERE se.user_id = s.id AND se.step_name = 'avatar_uploaded') THEN 'avatar_uploaded'
        WHEN EXISTS (SELECT 1 FROM step_events se WHERE se.user_id = s.id AND se.step_name = 'role_selected') THEN 'role_selected'
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

GRANT EXECUTE ON FUNCTION admin_get_onboarding_funnel_detail TO authenticated;
