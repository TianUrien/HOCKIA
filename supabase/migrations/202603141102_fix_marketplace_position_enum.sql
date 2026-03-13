-- Fix marketplace health: position is an enum, must cast to text before COALESCE with string

CREATE OR REPLACE FUNCTION admin_get_marketplace_health(
  p_days INT DEFAULT 30,
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
  -- Supply: players/coaches open to opportunities
  supply AS (
    SELECT
      COUNT(*) FILTER (WHERE role = 'player' AND open_to_opportunities = true) AS players_available,
      COUNT(*) FILTER (WHERE role = 'player') AS total_players,
      COUNT(*) FILTER (WHERE role = 'coach' AND open_to_opportunities = true) AS coaches_available,
      COUNT(*) FILTER (WHERE role = 'coach') AS total_coaches
    FROM profiles
    WHERE onboarding_completed = true
      AND id NOT IN (SELECT id FROM test_ids)
  ),
  -- Demand: open opportunities
  demand AS (
    SELECT
      COUNT(*) AS open_vacancies,
      COUNT(DISTINCT club_id) AS clubs_hiring,
      COUNT(*) FILTER (WHERE created_at >= v_since) AS new_vacancies_period
    FROM opportunities
    WHERE status = 'open'
      AND club_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Application velocity
  app_velocity AS (
    SELECT
      COUNT(*) AS applications_period,
      COUNT(DISTINCT applicant_id) AS unique_applicants,
      COUNT(DISTINCT opportunity_id) AS vacancies_applied_to
    FROM opportunity_applications
    WHERE applied_at >= v_since
      AND applicant_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Avg time to first application (for opportunities created in period)
  time_to_first AS (
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (first_app - o.created_at)) / 3600)::numeric, 1) AS avg_hours_to_first_app
    FROM opportunities o
    LEFT JOIN LATERAL (
      SELECT MIN(applied_at) AS first_app
      FROM opportunity_applications
      WHERE opportunity_id = o.id
    ) fa ON true
    WHERE o.created_at >= v_since
      AND o.status != 'draft'
      AND fa.first_app IS NOT NULL
      AND o.club_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Applicant status breakdown
  status_breakdown AS (
    SELECT
      oa.status,
      COUNT(*) AS count
    FROM opportunity_applications oa
    JOIN opportunities o ON oa.opportunity_id = o.id
    WHERE oa.applied_at >= v_since
      AND oa.applicant_id NOT IN (SELECT id FROM test_ids)
    GROUP BY oa.status
    ORDER BY count DESC
  ),
  -- Opportunities by position (cast enum to text)
  by_position AS (
    SELECT
      COALESCE(position::text, 'Unspecified') AS position,
      COUNT(*) AS count
    FROM opportunities
    WHERE status = 'open'
      AND club_id NOT IN (SELECT id FROM test_ids)
    GROUP BY position::text
    ORDER BY count DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'supply', (SELECT jsonb_build_object(
      'players_available', players_available,
      'total_players', total_players,
      'coaches_available', coaches_available,
      'total_coaches', total_coaches
    ) FROM supply),
    'demand', (SELECT jsonb_build_object(
      'open_vacancies', open_vacancies,
      'clubs_hiring', clubs_hiring,
      'new_vacancies_period', new_vacancies_period
    ) FROM demand),
    'velocity', (SELECT jsonb_build_object(
      'applications_period', applications_period,
      'unique_applicants', unique_applicants,
      'vacancies_applied_to', vacancies_applied_to,
      'avg_hours_to_first_app', COALESCE(ttf.avg_hours_to_first_app, 0)
    ) FROM app_velocity av, time_to_first ttf),
    'status_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', count)) FROM status_breakdown), '[]'::jsonb),
    'by_position', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', position, 'count', count)) FROM by_position), '[]'::jsonb),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_marketplace_health TO authenticated;
