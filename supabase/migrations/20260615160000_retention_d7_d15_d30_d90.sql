-- ─────────────────────────────────────────────────────────────────────
-- Retention markers → D7 / D15 / D30 / D90 (was D1/D7/D14/D30 for the
-- Overview cohorts, D1/Wk1/Wk2/Wk3-4 for the by-role/Churn view).
--
-- Also makes retention HONEST: each marker's % is now computed only over
-- members who have aged enough to reach that window (eligible), and returns
-- NULL when no member is old enough yet — instead of dividing by the whole
-- cohort (the old behaviour, which diluted recent cohorts toward 0 and would
-- make every D90 read ~0%). Windows: D7 = signup+7..13, D15 = +15..21,
-- D30 = +28..34, D90 = +88..94. user_engagement_daily keeps daily aggregates
-- forever, so ~160 days of history back D90.
--
-- The by-role cohort window is widened 8 → 16 weeks so the oldest cohorts can
-- actually reach D90.
-- ─────────────────────────────────────────────────────────────────────

-- ── Overview cohorts (RETURNS TABLE changes → DROP + CREATE + re-GRANT) ──
DROP FUNCTION IF EXISTS public.admin_get_retention_cohorts(INTEGER);

CREATE FUNCTION public.admin_get_retention_cohorts(
  p_months INTEGER DEFAULT 3
)
RETURNS TABLE (
  signup_month DATE,
  cohort_size INTEGER,
  d7_pct NUMERIC,
  d15_pct NUMERIC,
  d30_pct NUMERIC,
  d90_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH cohorts AS (
    SELECT
      DATE_TRUNC('month', p.created_at)::DATE AS signup_month,
      p.id AS user_id,
      p.created_at::DATE AS signup_date
    FROM profiles p
    WHERE NOT p.is_test_account
      AND p.created_at >= DATE_TRUNC('month', now()) - (p_months || ' months')::INTERVAL
  ),
  retention AS (
    SELECT
      c.signup_month,
      (c.signup_date + 13 <= current_date) AS elig_d7,
      EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.user_id AND ued.date BETWEEN c.signup_date + 7  AND c.signup_date + 13) AS ret_d7,
      (c.signup_date + 21 <= current_date) AS elig_d15,
      EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.user_id AND ued.date BETWEEN c.signup_date + 15 AND c.signup_date + 21) AS ret_d15,
      (c.signup_date + 34 <= current_date) AS elig_d30,
      EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.user_id AND ued.date BETWEEN c.signup_date + 28 AND c.signup_date + 34) AS ret_d30,
      (c.signup_date + 94 <= current_date) AS elig_d90,
      EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.user_id AND ued.date BETWEEN c.signup_date + 88 AND c.signup_date + 94) AS ret_d90
    FROM cohorts c
  )
  SELECT
    r.signup_month,
    COUNT(*)::INTEGER AS cohort_size,
    CASE WHEN COUNT(*) FILTER (WHERE r.elig_d7) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE r.elig_d7 AND r.ret_d7)::NUMERIC / COUNT(*) FILTER (WHERE r.elig_d7) * 100, 1) END AS d7_pct,
    CASE WHEN COUNT(*) FILTER (WHERE r.elig_d15) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE r.elig_d15 AND r.ret_d15)::NUMERIC / COUNT(*) FILTER (WHERE r.elig_d15) * 100, 1) END AS d15_pct,
    CASE WHEN COUNT(*) FILTER (WHERE r.elig_d30) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE r.elig_d30 AND r.ret_d30)::NUMERIC / COUNT(*) FILTER (WHERE r.elig_d30) * 100, 1) END AS d30_pct,
    CASE WHEN COUNT(*) FILTER (WHERE r.elig_d90) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE r.elig_d90 AND r.ret_d90)::NUMERIC / COUNT(*) FILTER (WHERE r.elig_d90) * 100, 1) END AS d90_pct
  FROM retention r
  GROUP BY r.signup_month
  ORDER BY r.signup_month DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_retention_cohorts(INTEGER) TO authenticated;

-- ── By-role / Churn view (RETURNS JSONB unchanged → CREATE OR REPLACE) ───
CREATE OR REPLACE FUNCTION public.admin_get_retention_by_role(
  p_cohort_weeks INT DEFAULT 16,
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
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
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
  retention_data AS (
    SELECT
      c.role,
      c.cohort_week,
      COUNT(DISTINCT c.id) AS cohort_size,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 13 <= current_date) AS elig_d7,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 13 <= current_date AND EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.id AND ued.date BETWEEN c.signup_date + 7  AND c.signup_date + 13)) AS ret_d7,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 21 <= current_date) AS elig_d15,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 21 <= current_date AND EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.id AND ued.date BETWEEN c.signup_date + 15 AND c.signup_date + 21)) AS ret_d15,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 34 <= current_date) AS elig_d30,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 34 <= current_date AND EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.id AND ued.date BETWEEN c.signup_date + 28 AND c.signup_date + 34)) AS ret_d30,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 94 <= current_date) AS elig_d90,
      COUNT(DISTINCT c.id) FILTER (WHERE c.signup_date + 94 <= current_date AND EXISTS (SELECT 1 FROM user_engagement_daily ued WHERE ued.user_id = c.id AND ued.date BETWEEN c.signup_date + 88 AND c.signup_date + 94)) AS ret_d90
    FROM cohorts c
    GROUP BY c.role, c.cohort_week
  ),
  role_retention AS (
    SELECT
      role,
      SUM(cohort_size) AS total_users,
      CASE WHEN SUM(elig_d7)  > 0 THEN ROUND(SUM(ret_d7)  * 100.0 / SUM(elig_d7),  1) END AS d7_pct,
      CASE WHEN SUM(elig_d15) > 0 THEN ROUND(SUM(ret_d15) * 100.0 / SUM(elig_d15), 1) END AS d15_pct,
      CASE WHEN SUM(elig_d30) > 0 THEN ROUND(SUM(ret_d30) * 100.0 / SUM(elig_d30), 1) END AS d30_pct,
      CASE WHEN SUM(elig_d90) > 0 THEN ROUND(SUM(ret_d90) * 100.0 / SUM(elig_d90), 1) END AS d90_pct
    FROM retention_data
    GROUP BY role
  ),
  weekly_cohorts AS (
    SELECT
      cohort_week,
      SUM(cohort_size) AS cohort_size,
      CASE WHEN SUM(elig_d7)  > 0 THEN ROUND(SUM(ret_d7)  * 100.0 / SUM(elig_d7),  1) END AS d7_pct,
      CASE WHEN SUM(elig_d15) > 0 THEN ROUND(SUM(ret_d15) * 100.0 / SUM(elig_d15), 1) END AS d15_pct,
      CASE WHEN SUM(elig_d30) > 0 THEN ROUND(SUM(ret_d30) * 100.0 / SUM(elig_d30), 1) END AS d30_pct,
      CASE WHEN SUM(elig_d90) > 0 THEN ROUND(SUM(ret_d90) * 100.0 / SUM(elig_d90), 1) END AS d90_pct
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
