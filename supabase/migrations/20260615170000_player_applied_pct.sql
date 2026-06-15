-- ─────────────────────────────────────────────────────────────────────
-- Percentages sweep (Admin Portal) — add applied-rate denominators.
--
-- The AdminPlayers page shows "Applied (Ever)" and "Applied (7d)" as raw
-- counts with no denominator. The founder asked every metric to read with
-- its denominator ("X applied · Y% of players"). players_with_video_pct
-- already exists; this adds the two matching applied-rate percentages so the
-- page can render them without a second round-trip.
--
-- Both the count AND the percentage are scoped to non-test PLAYER applicants
-- (joined through profiles), matching the denominator (non-test players) and
-- every other player metric on the page. Counting raw applicant_id would let
-- test / non-player applicants push the rate over 100% (staging showed 117%).
--
-- JSON return → CREATE OR REPLACE is safe (no signature change). Full body
-- reproduced so the replace is atomic.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_extended_dashboard_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT json_build_object(
    'vacancies_7d', (SELECT COUNT(*) FROM opportunities WHERE created_at > now() - interval '7 days'),
    'vacancies_30d', (SELECT COUNT(*) FROM opportunities WHERE created_at > now() - interval '30 days'),
    'avg_apps_per_vacancy', (
      SELECT ROUND(AVG(app_count)::NUMERIC, 1)
      FROM (
        SELECT COUNT(oa.id) as app_count
        FROM opportunities o
        LEFT JOIN opportunity_applications oa ON oa.opportunity_id = o.id
        WHERE o.status IN ('open', 'closed')
        GROUP BY o.id
      ) sub
    ),
    'active_clubs_7d', (
      SELECT COUNT(DISTINCT club_id) FROM opportunities
      WHERE created_at > now() - interval '7 days'
    ),
    'active_clubs_30d', (
      SELECT COUNT(DISTINCT club_id) FROM opportunities
      WHERE created_at > now() - interval '30 days'
    ),
    'vacancy_fill_rate', (
      SELECT ROUND(
        COUNT(*) FILTER (WHERE status = 'closed')::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 0
      )
      FROM opportunities
      WHERE created_at > now() - interval '90 days'
    ),

    'players_with_video', (
      SELECT COUNT(*) FROM profiles
      WHERE role = 'player' AND NOT is_test_account
        AND highlight_video_url IS NOT NULL
    ),
    'players_with_video_pct', (
      SELECT ROUND(
        COUNT(*) FILTER (WHERE highlight_video_url IS NOT NULL)::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 0
      )
      FROM profiles
      WHERE role = 'player' AND NOT is_test_account
    ),
    'players_applied_ever', (
      SELECT COUNT(DISTINCT oa.applicant_id)
      FROM opportunity_applications oa
      JOIN profiles p ON p.id = oa.applicant_id
      WHERE p.role = 'player' AND NOT p.is_test_account
    ),
    'players_applied_ever_pct', (
      SELECT ROUND(
        (SELECT COUNT(DISTINCT oa.applicant_id)
           FROM opportunity_applications oa
           JOIN profiles pp ON pp.id = oa.applicant_id
           WHERE pp.role = 'player' AND NOT pp.is_test_account)::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 0
      )
      FROM profiles
      WHERE role = 'player' AND NOT is_test_account
    ),
    'players_applied_7d', (
      SELECT COUNT(DISTINCT oa.applicant_id)
      FROM opportunity_applications oa
      JOIN profiles p ON p.id = oa.applicant_id
      WHERE p.role = 'player' AND NOT p.is_test_account
        AND oa.applied_at > now() - interval '7 days'
    ),
    'players_applied_7d_pct', (
      SELECT ROUND(
        (SELECT COUNT(DISTINCT oa.applicant_id)
           FROM opportunity_applications oa
           JOIN profiles pp ON pp.id = oa.applicant_id
           WHERE pp.role = 'player' AND NOT pp.is_test_account
             AND oa.applied_at > now() - interval '7 days')::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 0
      )
      FROM profiles
      WHERE role = 'player' AND NOT is_test_account
    ),
    'avg_profile_score', (
      SELECT ROUND(AVG(score)::NUMERIC, 0)
      FROM (
        SELECT
          (
            CASE WHEN nationality IS NOT NULL AND base_location IS NOT NULL AND "position" IS NOT NULL THEN 25 ELSE 0 END +
            CASE WHEN avatar_url IS NOT NULL THEN 20 ELSE 0 END +
            CASE WHEN highlight_video_url IS NOT NULL THEN 25 ELSE 0 END
          ) as score
        FROM profiles
        WHERE role = 'player' AND NOT is_test_account
      ) sub
    ),
    'onboarding_rate', (
      SELECT ROUND(
        COUNT(*) FILTER (WHERE onboarding_completed)::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 0
      )
      FROM profiles
      WHERE NOT is_test_account
    ),

    'application_status_breakdown', (
      SELECT json_build_object(
        'pending', COUNT(*) FILTER (WHERE status = 'pending'),
        'shortlisted', COUNT(*) FILTER (WHERE status = 'shortlisted'),
        'maybe', COUNT(*) FILTER (WHERE status = 'maybe'),
        'rejected', COUNT(*) FILTER (WHERE status = 'rejected')
      )
      FROM opportunity_applications
    ),

    'generated_at', now()
  ) INTO v_stats;

  RETURN v_stats;
END;
$$;

COMMENT ON FUNCTION public.admin_get_extended_dashboard_stats IS 'Extended dashboard statistics with opportunity and player insights (+ applied-rate percentages)';
