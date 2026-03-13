-- Role-Segmented Retention RPC
-- Day 1/7/14/30 retention curves segmented by role

CREATE OR REPLACE FUNCTION admin_get_retention_by_role(
  p_cohort_weeks INT DEFAULT 8,
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
  -- Cohort assignment: week of signup + role
  cohorts AS (
    SELECT
      p.id,
      p.role,
      date_trunc('week', p.created_at)::date AS cohort_week,
      p.created_at::date AS signup_date
    FROM profiles p
    WHERE p.onboarding_completed = true
      AND p.id NOT IN (SELECT id FROM test_ids)
      AND p.created_at >= NOW() - (p_cohort_weeks || ' weeks')::INTERVAL
      AND COALESCE(p.is_blocked, false) = false
  ),
  -- Retention by day offset and role
  retention_data AS (
    SELECT
      c.role,
      c.cohort_week,
      COUNT(DISTINCT c.id) AS cohort_size,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM user_engagement_daily ued
        WHERE ued.user_id = c.id AND ued.date = c.signup_date + 1
      ) THEN c.id END) AS day_1,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM user_engagement_daily ued
        WHERE ued.user_id = c.id AND ued.date BETWEEN c.signup_date + 1 AND c.signup_date + 7
      ) THEN c.id END) AS week_1,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM user_engagement_daily ued
        WHERE ued.user_id = c.id AND ued.date BETWEEN c.signup_date + 8 AND c.signup_date + 14
      ) THEN c.id END) AS week_2,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM user_engagement_daily ued
        WHERE ued.user_id = c.id AND ued.date BETWEEN c.signup_date + 15 AND c.signup_date + 30
      ) THEN c.id END) AS week_3_4
    FROM cohorts c
    GROUP BY c.role, c.cohort_week
  ),
  -- Aggregate by role (all cohorts combined)
  role_retention AS (
    SELECT
      role,
      SUM(cohort_size) AS total_users,
      ROUND((SUM(day_1) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS day_1_pct,
      ROUND((SUM(week_1) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS week_1_pct,
      ROUND((SUM(week_2) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS week_2_pct,
      ROUND((SUM(week_3_4) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS week_3_4_pct
    FROM retention_data
    GROUP BY role
  ),
  -- Weekly cohort detail (all roles combined)
  weekly_cohorts AS (
    SELECT
      cohort_week,
      SUM(cohort_size) AS cohort_size,
      ROUND((SUM(day_1) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS day_1_pct,
      ROUND((SUM(week_1) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS week_1_pct,
      ROUND((SUM(week_2) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS week_2_pct,
      ROUND((SUM(week_3_4) * 100.0 / NULLIF(SUM(cohort_size), 0))::numeric, 1) AS week_3_4_pct
    FROM retention_data
    GROUP BY cohort_week
    ORDER BY cohort_week
  )
  SELECT jsonb_build_object(
    'by_role', COALESCE((SELECT jsonb_agg(row_to_json(rr)::jsonb) FROM role_retention rr), '[]'::jsonb),
    'weekly_cohorts', COALESCE((SELECT jsonb_agg(row_to_json(wc)::jsonb) FROM weekly_cohorts wc), '[]'::jsonb),
    'cohort_weeks', p_cohort_weeks
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_retention_by_role TO authenticated;
