-- Churn Analysis RPC
-- Inactive users, last action distribution, re-engagement, churn risk

CREATE OR REPLACE FUNCTION admin_get_churn_analysis(
  p_days INT DEFAULT 30,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
  -- All real users who completed onboarding
  active_base AS (
    SELECT
      p.id,
      p.role,
      p.created_at AS signup_at,
      COALESCE(
        (SELECT MAX(date) FROM user_engagement_daily ued WHERE ued.user_id = p.id),
        p.created_at::date
      ) AS last_active_date
    FROM profiles p
    WHERE p.onboarding_completed = true
      AND p.id NOT IN (SELECT id FROM test_ids)
      AND COALESCE(p.is_blocked, false) = false
  ),
  -- Inactive counts by tier
  inactive_tiers AS (
    SELECT
      COUNT(*) FILTER (WHERE last_active_date < CURRENT_DATE - 7) AS inactive_7d,
      COUNT(*) FILTER (WHERE last_active_date < CURRENT_DATE - 14) AS inactive_14d,
      COUNT(*) FILTER (WHERE last_active_date < CURRENT_DATE - 30) AS inactive_30d,
      COUNT(*) FILTER (WHERE last_active_date < CURRENT_DATE - 60) AS inactive_60d,
      COUNT(*) AS total_users
    FROM active_base
  ),
  -- Churned by role (inactive 14+ days)
  churn_by_role AS (
    SELECT
      role,
      COUNT(*) AS churned_count,
      COUNT(*) FILTER (WHERE last_active_date >= CURRENT_DATE - 14) AS active_count
    FROM active_base
    GROUP BY role
  ),
  -- Last action before churn (users inactive 14+ days)
  last_actions AS (
    SELECT
      e.event_name AS last_action,
      COUNT(DISTINCT e.user_id) AS user_count
    FROM (
      SELECT DISTINCT ON (user_id) user_id, event_name, created_at
      FROM events
      WHERE user_id IN (
        SELECT id FROM active_base WHERE last_active_date < CURRENT_DATE - 14
      )
        AND event_name NOT IN ('page_view', 'session_start')
      ORDER BY user_id, created_at DESC
    ) e
    GROUP BY e.event_name
    ORDER BY user_count DESC
    LIMIT 10
  ),
  -- Engagement before churn (avg sessions/time for churned users in their last active week)
  churn_engagement AS (
    SELECT
      ROUND(AVG(total_sessions)::numeric, 1) AS avg_sessions_before_churn,
      ROUND(AVG(total_seconds / 60.0)::numeric, 1) AS avg_minutes_before_churn
    FROM (
      SELECT
        ab.id,
        COALESCE(SUM(ued.session_count), 0) AS total_sessions,
        COALESCE(SUM(ued.total_seconds), 0) AS total_seconds
      FROM active_base ab
      LEFT JOIN user_engagement_daily ued
        ON ued.user_id = ab.id
        AND ued.date BETWEEN ab.last_active_date - 7 AND ab.last_active_date
      WHERE ab.last_active_date < CURRENT_DATE - 14
      GROUP BY ab.id
    ) sub
  ),
  -- Re-engaged users (were inactive 14+ days, then came back in the last p_days)
  re_engaged AS (
    SELECT COUNT(DISTINCT ued.user_id) AS re_engaged_count
    FROM user_engagement_daily ued
    WHERE ued.date >= CURRENT_DATE - p_days
      AND ued.user_id IN (
        -- Users who had a gap of 14+ days before their recent activity
        SELECT ab.id FROM active_base ab
        WHERE EXISTS (
          SELECT 1 FROM user_engagement_daily ued2
          WHERE ued2.user_id = ab.id
            AND ued2.date >= CURRENT_DATE - p_days
        )
        AND EXISTS (
          SELECT 1 FROM user_engagement_daily ued3
          WHERE ued3.user_id = ab.id
            AND ued3.date < CURRENT_DATE - p_days
            AND NOT EXISTS (
              SELECT 1 FROM user_engagement_daily ued4
              WHERE ued4.user_id = ab.id
                AND ued4.date BETWEEN ued3.date + 1 AND ued3.date + 14
            )
        )
      )
      AND ued.user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- At-risk users (declining engagement: active this week but less than previous weeks)
  at_risk AS (
    SELECT
      ab.id AS profile_id,
      p.full_name AS display_name,
      p.role,
      ab.last_active_date,
      this_week.sessions AS sessions_this_week,
      prev_week.sessions AS sessions_prev_week
    FROM active_base ab
    JOIN profiles p ON p.id = ab.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(session_count), 0) AS sessions
      FROM user_engagement_daily
      WHERE user_id = ab.id AND date >= CURRENT_DATE - 7
    ) this_week ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(session_count), 0) AS sessions
      FROM user_engagement_daily
      WHERE user_id = ab.id AND date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8
    ) prev_week ON true
    WHERE ab.last_active_date >= CURRENT_DATE - 14
      AND prev_week.sessions > 0
      AND this_week.sessions < prev_week.sessions * 0.5  -- 50%+ decline
    ORDER BY prev_week.sessions - this_week.sessions DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'inactive_tiers', (SELECT row_to_json(it)::jsonb FROM inactive_tiers it),
    'churn_by_role', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'role', role,
      'churned', churned_count,
      'active', active_count,
      'churn_rate', CASE WHEN churned_count + active_count > 0
        THEN ROUND((churned_count * 100.0 / (churned_count + active_count))::numeric, 1) ELSE 0 END
    )) FROM churn_by_role), '[]'::jsonb),
    'last_action_before_churn', COALESCE((SELECT jsonb_agg(row_to_json(la)::jsonb) FROM last_actions la), '[]'::jsonb),
    'engagement_before_churn', (SELECT row_to_json(ce)::jsonb FROM churn_engagement ce),
    're_engaged_users', (SELECT re_engaged_count FROM re_engaged),
    'at_risk_users', COALESCE((SELECT jsonb_agg(row_to_json(ar)::jsonb) FROM at_risk ar), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_churn_analysis TO authenticated;
