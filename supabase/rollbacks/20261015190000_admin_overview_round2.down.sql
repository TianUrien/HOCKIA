-- Rollback for 20261015190000_admin_overview_round2.sql.
-- Restores the three pre-existing functions to their bodies as read from
-- staging/prod on 2026-10-15 (md5 fa9a5341… / d7db8075… / 48e5463f…) and
-- drops the two new ones.

DROP FUNCTION IF EXISTS public.admin_get_recruiting_funnel(integer);
DROP FUNCTION IF EXISTS public.admin_get_signups_by_channel_week(integer);

CREATE OR REPLACE FUNCTION public.admin_get_command_center(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_period_start TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_total_users BIGINT;
  v_total_users_prev BIGINT;
  v_mau BIGINT;
  v_wau BIGINT;
  v_dau BIGINT;
  v_live_opps BIGINT;
  v_live_opps_prev BIGINT;
  v_apps_period BIGINT;
  v_apps_prev BIGINT;
  v_vacancy_views BIGINT;
  v_profile_complete BIGINT;
  v_total_non_test BIGINT;
  v_d7_cohort_size BIGINT;
  v_d7_retained BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_period_start := now() - (p_days || ' days')::INTERVAL;
  v_prev_start := now() - (p_days * 2 || ' days')::INTERVAL;

  SELECT COUNT(*) INTO v_total_users
  FROM profiles WHERE NOT is_test_account;

  SELECT COUNT(*) INTO v_total_users_prev
  FROM profiles WHERE NOT is_test_account AND created_at <= v_period_start;

  SELECT COUNT(DISTINCT ued.user_id) INTO v_mau
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date > CURRENT_DATE - 30
    AND NOT p.is_test_account;

  SELECT COUNT(DISTINCT ued.user_id) INTO v_wau
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date > CURRENT_DATE - 7
    AND NOT p.is_test_account;

  SELECT COUNT(DISTINCT ued.user_id) INTO v_dau
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date = CURRENT_DATE
    AND NOT p.is_test_account;

  SELECT COUNT(*) INTO v_live_opps
  FROM opportunities o
  JOIN profiles p ON p.id = o.club_id
  WHERE o.status = 'open'
    AND NOT p.is_test_account;

  SELECT COUNT(*) INTO v_live_opps_prev
  FROM opportunities o
  JOIN profiles p ON p.id = o.club_id
  WHERE o.created_at <= v_period_start
    AND o.status IN ('open', 'closed')
    AND (o.closed_at IS NULL OR o.closed_at > v_period_start)
    AND (o.published_at IS NOT NULL AND o.published_at <= v_period_start)
    AND NOT p.is_test_account;

  SELECT COUNT(*) INTO v_apps_period
  FROM opportunity_applications oa
  JOIN profiles applicant ON applicant.id = oa.applicant_id
  JOIN opportunities o ON o.id = oa.opportunity_id
  JOIN profiles club ON club.id = o.club_id
  WHERE oa.applied_at > v_period_start
    AND NOT applicant.is_test_account
    AND NOT club.is_test_account;

  SELECT COUNT(*) INTO v_apps_prev
  FROM opportunity_applications oa
  JOIN profiles applicant ON applicant.id = oa.applicant_id
  JOIN opportunities o ON o.id = oa.opportunity_id
  JOIN profiles club ON club.id = o.club_id
  WHERE oa.applied_at > v_prev_start
    AND oa.applied_at <= v_period_start
    AND NOT applicant.is_test_account
    AND NOT club.is_test_account;

  SELECT COUNT(*) INTO v_vacancy_views
  FROM events e
  JOIN profiles p ON p.id = e.user_id
  WHERE e.event_name = 'vacancy_view'
    AND e.created_at > v_period_start
    AND NOT p.is_test_account;

  SELECT COUNT(*) INTO v_total_non_test
  FROM profiles WHERE NOT is_test_account;

  SELECT COUNT(*) INTO v_profile_complete
  FROM profiles
  WHERE NOT is_test_account
    AND avatar_url IS NOT NULL
    AND bio IS NOT NULL AND bio != '';

  SELECT COUNT(*) INTO v_d7_cohort_size
  FROM profiles
  WHERE NOT is_test_account
    AND created_at::DATE BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8;

  SELECT COUNT(DISTINCT p.id) INTO v_d7_retained
  FROM profiles p
  JOIN user_engagement_daily ued ON ued.user_id = p.id
  WHERE NOT p.is_test_account
    AND p.created_at::DATE BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 8
    AND ued.date BETWEEN p.created_at::DATE + 7 AND p.created_at::DATE + 13;

  SELECT json_build_object(
    'total_users', v_total_users,
    'total_users_prev', v_total_users_prev,
    'mau', v_mau,
    'wau', v_wau,
    'dau', v_dau,
    'wau_mau_ratio', CASE WHEN v_mau > 0 THEN ROUND(v_wau::NUMERIC / v_mau * 100, 1) ELSE 0 END,
    'live_opportunities', v_live_opps,
    'live_opportunities_prev', v_live_opps_prev,
    'applications_period', v_apps_period,
    'applications_prev', v_apps_prev,
    'application_conversion', CASE WHEN v_vacancy_views > 0
      THEN ROUND(v_apps_period::NUMERIC / v_vacancy_views * 100, 1)
      ELSE 0 END,
    'profile_completion_pct', CASE WHEN v_total_non_test > 0
      THEN ROUND(v_profile_complete::NUMERIC / v_total_non_test * 100, 1)
      ELSE 0 END,
    'role_distribution', (
      SELECT json_build_object(
        'player', COUNT(*) FILTER (WHERE role = 'player'),
        'coach', COUNT(*) FILTER (WHERE role = 'coach'),
        'club', COUNT(*) FILTER (WHERE role = 'club'),
        'brand', COUNT(*) FILTER (WHERE role = 'brand')
      ) FROM profiles WHERE NOT is_test_account
    ),
    'd7_retention', CASE WHEN v_d7_cohort_size > 0
      THEN ROUND(v_d7_retained::NUMERIC / v_d7_cohort_size * 100, 1)
      ELSE 0 END,
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_command_center(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_command_center(integer) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_get_signup_trends(integer);
CREATE FUNCTION public.admin_get_signup_trends(p_days integer DEFAULT 30)
 RETURNS TABLE(date date, total_signups bigint, players bigint, coaches bigint, clubs bigint, brands bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    d.date::DATE,
    COALESCE(COUNT(p.id), 0) AS total_signups,
    COALESCE(COUNT(p.id) FILTER (WHERE p.role = 'player'), 0) AS players,
    COALESCE(COUNT(p.id) FILTER (WHERE p.role = 'coach'), 0) AS coaches,
    COALESCE(COUNT(p.id) FILTER (WHERE p.role = 'club'), 0) AS clubs,
    COALESCE(COUNT(p.id) FILTER (WHERE p.role = 'brand'), 0) AS brands
  FROM generate_series(
    (now() - (p_days || ' days')::INTERVAL)::DATE,
    now()::DATE,
    '1 day'::INTERVAL
  ) AS d(date)
  LEFT JOIN profiles p ON p.created_at::DATE = d.date AND NOT p.is_test_account
  GROUP BY d.date
  ORDER BY d.date ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_signup_trends(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_signup_trends(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_notification_ctr(p_days integer DEFAULT 30)
 RETURNS TABLE(kind text, sent_count bigint, click_count bigint, ctr_pct numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH sent AS (
    SELECT n.kind::text AS k, COUNT(*)::BIGINT AS cnt
    FROM profile_notifications n
    JOIN profiles p ON p.id = n.recipient_profile_id
    WHERE n.created_at >= v_since
      AND NOT p.is_test_account
    GROUP BY n.kind
  ),
  clicks AS (
    SELECT
      e.properties->>'kind' AS k,
      COUNT(*)::BIGINT AS cnt
    FROM events e
    JOIN profiles p ON p.id = e.user_id
    WHERE e.event_name = 'notification_click'
      AND e.created_at >= v_since
      AND NOT p.is_test_account
      AND e.properties->>'kind' IS NOT NULL
    GROUP BY e.properties->>'kind'
  )
  SELECT
    s.k,
    s.cnt,
    COALESCE(c.cnt, 0)::BIGINT,
    LEAST(
      100::NUMERIC,
      ROUND(COALESCE(c.cnt, 0)::NUMERIC / NULLIF(s.cnt, 0) * 100, 1)
    )
  FROM sent s
  LEFT JOIN clicks c ON c.k = s.k
  ORDER BY s.cnt DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_notification_ctr(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_ctr(integer) TO authenticated;
