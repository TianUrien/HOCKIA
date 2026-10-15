-- Admin Overview round 2 (2026-10-15): honest measurements and the recruiting
-- loop as a funnel. Audit source: docs/engineering/analytics-tracking-plan.md.
--
-- 1. admin_get_command_center — DAU/WAU/MAU over COMPLETE days (yesterday back),
--    so the headline never reads low because today is half over; the day is
--    returned as dau_date. View-to-apply becomes unique viewer→role pairs that
--    went on to apply ÷ unique pairs that viewed (same window), not event ÷ event.
--    Umpires join the role split.
-- 2. admin_get_signup_trends — umpires column (return type changes → drop first).
-- 3. admin_get_notification_ctr — clicks counted as distinct notifications of
--    the sent cohort; no 100 % clamp (a clamp hides a measurement bug).
-- 4. admin_get_recruiting_funnel — NEW: roles posted → viewed → applied →
--    shortlisted → invited → offered → signed, with people counts and medians.
-- 5. admin_get_signups_by_channel_week — NEW: sign-ups per Monday week by
--    first-touch channel group, for the acquisition trend.
-- All admin-gated, SECURITY DEFINER, test accounts excluded, explicit GRANTs.

-- 1 ────────────────────────────────────────────────────────────────────────
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
  v_dau_date DATE := CURRENT_DATE - 1;  -- last complete day
  v_total_users BIGINT;
  v_total_users_prev BIGINT;
  v_mau BIGINT;
  v_wau BIGINT;
  v_dau BIGINT;
  v_live_opps BIGINT;
  v_live_opps_prev BIGINT;
  v_apps_period BIGINT;
  v_apps_prev BIGINT;
  v_view_pairs BIGINT;
  v_applied_pairs BIGINT;
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

  -- Complete days only: [yesterday-29, yesterday], [yesterday-6, yesterday], yesterday.
  SELECT COUNT(DISTINCT ued.user_id) INTO v_mau
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date BETWEEN v_dau_date - 29 AND v_dau_date
    AND NOT p.is_test_account;

  SELECT COUNT(DISTINCT ued.user_id) INTO v_wau
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date BETWEEN v_dau_date - 6 AND v_dau_date
    AND NOT p.is_test_account;

  SELECT COUNT(DISTINCT ued.user_id) INTO v_dau
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date = v_dau_date
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

  -- Raw view events (kept for the detailed metrics) …
  SELECT COUNT(*) INTO v_vacancy_views
  FROM events e
  JOIN profiles p ON p.id = e.user_id
  WHERE e.event_name = 'vacancy_view'
    AND e.created_at > v_period_start
    AND NOT p.is_test_account;

  -- … and the conversion the way a person would count it: of the signed-in
  -- members who looked at a role in the window, how many applied to that role.
  WITH views AS (
    SELECT e.user_id, e.entity_id AS opportunity_id, MIN(e.created_at) AS first_view
    FROM events e
    JOIN profiles p ON p.id = e.user_id
    JOIN opportunities o ON o.id = e.entity_id
    JOIN profiles club ON club.id = o.club_id
    WHERE e.event_name = 'vacancy_view'
      AND e.created_at > v_period_start
      AND e.entity_id IS NOT NULL
      AND NOT p.is_test_account
      AND NOT club.is_test_account
    GROUP BY e.user_id, e.entity_id
  )
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM opportunity_applications oa
           WHERE oa.applicant_id = views.user_id
             AND oa.opportunity_id = views.opportunity_id
             AND oa.applied_at >= views.first_view
             AND oa.applied_at > v_period_start))
  INTO v_view_pairs, v_applied_pairs
  FROM views;

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
    'dau_date', v_dau_date,
    'wau_mau_ratio', CASE WHEN v_mau > 0 THEN ROUND(v_wau::NUMERIC / v_mau * 100, 1) ELSE NULL END,
    'live_opportunities', v_live_opps,
    'live_opportunities_prev', v_live_opps_prev,
    'applications_period', v_apps_period,
    'applications_prev', v_apps_prev,
    'vacancy_views', v_vacancy_views,
    'view_pairs', v_view_pairs,
    'applied_pairs', v_applied_pairs,
    'application_conversion', CASE WHEN v_view_pairs > 0
      THEN ROUND(v_applied_pairs::NUMERIC / v_view_pairs * 100, 1)
      ELSE NULL END,
    'profile_completion_pct', CASE WHEN v_total_non_test > 0
      THEN ROUND(v_profile_complete::NUMERIC / v_total_non_test * 100, 1)
      ELSE NULL END,
    'role_distribution', (
      SELECT json_build_object(
        'player', COUNT(*) FILTER (WHERE role = 'player'),
        'coach', COUNT(*) FILTER (WHERE role = 'coach'),
        'club', COUNT(*) FILTER (WHERE role = 'club'),
        'umpire', COUNT(*) FILTER (WHERE role = 'umpire'),
        'brand', COUNT(*) FILTER (WHERE role = 'brand')
      ) FROM profiles WHERE NOT is_test_account
    ),
    'd7_retention', CASE WHEN v_d7_cohort_size > 0
      THEN ROUND(v_d7_retained::NUMERIC / v_d7_cohort_size * 100, 1)
      ELSE NULL END,
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_command_center(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_command_center(integer) TO authenticated;

-- 2 ────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_get_signup_trends(integer);
CREATE FUNCTION public.admin_get_signup_trends(p_days integer DEFAULT 30)
 RETURNS TABLE(date date, total_signups bigint, players bigint, coaches bigint, clubs bigint, brands bigint, umpires bigint)
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
    COALESCE(COUNT(p.id) FILTER (WHERE p.role = 'brand'), 0) AS brands,
    COALESCE(COUNT(p.id) FILTER (WHERE p.role = 'umpire'), 0) AS umpires
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

-- 3 ────────────────────────────────────────────────────────────────────────
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
  -- A notification counts as clicked once, and only if it belongs to the
  -- sent cohort above (same window), so clicks can never exceed sends.
  clicks AS (
    SELECT n.kind::text AS k, COUNT(DISTINCT n.id)::BIGINT AS cnt
    FROM events e
    JOIN profile_notifications n ON n.id = e.entity_id
    JOIN profiles p ON p.id = e.user_id
    WHERE e.event_name = 'notification_click'
      AND n.created_at >= v_since
      AND NOT p.is_test_account
    GROUP BY n.kind
  )
  SELECT
    s.k,
    s.cnt,
    COALESCE(c.cnt, 0)::BIGINT,
    ROUND(COALESCE(c.cnt, 0)::NUMERIC / NULLIF(s.cnt, 0) * 100, 1)
  FROM sent s
  LEFT JOIN clicks c ON c.k = s.k
  ORDER BY s.cnt DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_notification_ctr(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_ctr(integer) TO authenticated;

-- 4 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_recruiting_funnel(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since TIMESTAMPTZ := now() - (GREATEST(1, LEAST(p_days, 365)) || ' days')::INTERVAL;
  v_result JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  WITH test_accounts AS (
    SELECT id FROM profiles WHERE is_test_account
  ),
  roles AS (
    SELECT o.id, o.club_id, COALESCE(o.published_at, o.created_at) AS posted_at
    FROM opportunities o
    WHERE COALESCE(o.published_at, o.created_at) > v_since
      AND o.club_id NOT IN (SELECT id FROM test_accounts)
  ),
  views AS (
    SELECT e.entity_id AS opportunity_id, COALESCE(e.user_id::text, e.anonymous_id) AS viewer
    FROM events e
    WHERE e.event_name = 'vacancy_view'
      AND e.created_at > v_since
      AND e.entity_id IS NOT NULL
      AND (e.user_id IS NULL OR e.user_id NOT IN (SELECT id FROM test_accounts))
      AND (e.properties->>'is_automated') IS NULL
  ),
  apps AS (
    SELECT oa.id, oa.opportunity_id, oa.applicant_id, oa.applied_at, oa.status, oa.signed_at
    FROM opportunity_applications oa
    JOIN opportunities o ON o.id = oa.opportunity_id
    WHERE oa.applied_at > v_since
      AND oa.applicant_id NOT IN (SELECT id FROM test_accounts)
      AND o.club_id NOT IN (SELECT id FROM test_accounts)
  ),
  invites AS (
    SELECT i.id, i.player_id, i.sent_at, i.responded_at
    FROM opportunity_invites i
    WHERE i.sent_at > v_since
      AND i.club_id NOT IN (SELECT id FROM test_accounts)
      AND i.player_id NOT IN (SELECT id FROM test_accounts)
  ),
  offers AS (
    SELECT f.id, f.player_id, f.sent_at, f.responded_at
    FROM opportunity_offers f
    WHERE f.sent_at > v_since
      AND f.club_id NOT IN (SELECT id FROM test_accounts)
      AND f.player_id NOT IN (SELECT id FROM test_accounts)
  ),
  signed AS (
    SELECT oa.id, oa.applicant_id
    FROM opportunity_applications oa
    JOIN opportunities o ON o.id = oa.opportunity_id
    WHERE oa.signed_at > v_since
      AND oa.applicant_id NOT IN (SELECT id FROM test_accounts)
      AND o.club_id NOT IN (SELECT id FROM test_accounts)
  ),
  first_app AS (
    SELECT r.id, r.posted_at, MIN(a.applied_at) AS first_applied_at
    FROM roles r JOIN apps a ON a.opportunity_id = r.id
    GROUP BY r.id, r.posted_at
  )
  SELECT json_build_object(
    'period_days', p_days,
    'steps', json_build_array(
      json_build_object('key', 'posted',      'label', 'Roles posted',      'count', (SELECT COUNT(*) FROM roles),                                  'people', (SELECT COUNT(DISTINCT club_id) FROM roles),            'unit', 'roles',        'people_unit', 'clubs'),
      json_build_object('key', 'viewed',      'label', 'Roles viewed',      'count', (SELECT COUNT(DISTINCT opportunity_id) FROM views),            'people', (SELECT COUNT(DISTINCT viewer) FROM views),             'unit', 'roles',        'people_unit', 'viewers'),
      json_build_object('key', 'applied',     'label', 'Applications',      'count', (SELECT COUNT(*) FROM apps),                                   'people', (SELECT COUNT(DISTINCT applicant_id) FROM apps),        'unit', 'applications', 'people_unit', 'applicants'),
      json_build_object('key', 'shortlisted', 'label', 'Shortlisted',       'count', (SELECT COUNT(*) FROM apps WHERE status = 'shortlisted'),      'people', (SELECT COUNT(DISTINCT applicant_id) FROM apps WHERE status = 'shortlisted'), 'unit', 'applications', 'people_unit', 'players'),
      json_build_object('key', 'invited',     'label', 'Invited to apply',  'count', (SELECT COUNT(*) FROM invites),                                'people', (SELECT COUNT(DISTINCT player_id) FROM invites),         'unit', 'invites',      'people_unit', 'players'),
      json_build_object('key', 'offered',     'label', 'Offers sent',       'count', (SELECT COUNT(*) FROM offers),                                 'people', (SELECT COUNT(DISTINCT player_id) FROM offers),          'unit', 'offers',       'people_unit', 'players'),
      json_build_object('key', 'signed',      'label', 'Signed',            'count', (SELECT COUNT(*) FROM signed),                                 'people', (SELECT COUNT(DISTINCT applicant_id) FROM signed),      'unit', 'signings',     'people_unit', 'players')
    ),
    'medians', json_build_object(
      'role_to_first_application_hours', (SELECT ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_applied_at - posted_at)) / 3600))::numeric, 1) FROM first_app),
      'invite_response_hours',           (SELECT ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (responded_at - sent_at)) / 3600))::numeric, 1) FROM invites WHERE responded_at IS NOT NULL),
      'offer_response_hours',            (SELECT ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (responded_at - sent_at)) / 3600))::numeric, 1) FROM offers WHERE responded_at IS NOT NULL),
      'roles_with_application', (SELECT COUNT(*) FROM first_app),
      'applications_without_reply', (SELECT COUNT(*) FROM apps WHERE status IN ('no_response', 'pending'))
    ),
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_recruiting_funnel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_recruiting_funnel(integer) TO authenticated;

-- 5 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_signups_by_channel_week(p_days integer DEFAULT 91)
 RETURNS TABLE(week date, channel_group text, signups bigint, measured bigint)
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
    date_trunc('week', sa.signup_at)::DATE AS week,
    COALESCE(NULLIF(sa.first_touch_group, ''), 'unknown') AS channel_group,
    COUNT(*)::BIGINT AS signups,
    COUNT(*) FILTER (WHERE sa.attribution_method IN ('utm', 'referrer', 'deep_link', 'install_referrer'))::BIGINT AS measured
  FROM signup_attribution sa
  LEFT JOIN profiles p ON p.id = sa.user_id
  WHERE sa.signup_at > now() - (GREATEST(1, LEAST(p_days, 365)) || ' days')::INTERVAL
    AND COALESCE(p.is_test_account, false) = false
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_signups_by_channel_week(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_signups_by_channel_week(integer) TO authenticated;
