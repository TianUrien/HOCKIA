-- ============================================================================
-- Migration: admin RPC test-account leakage sweep
--
-- Discovered during the round-3 audit of Product Health Score: the same
-- is_test_account leakage that inflated PHS sub-scores also affects five
-- other admin analytics RPCs. PHS round-2 (20260427170000) was scoped to
-- compute_product_health_score() only; this migration extends the same
-- discipline to:
--
--   1. admin_get_engagement_summary        — total leakage (no test filter)
--   2. admin_get_engagement_trends         — total leakage
--   3. admin_get_brand_activity            — total leakage
--   4. admin_get_command_center            — partial (DAU/WAU/MAU, opps,
--                                            apps, vacancy_views)
--   5. admin_get_dashboard_stats           — partial (brands, vacancies,
--                                            apps, messaging, friendships,
--                                            devices)
--
-- Filtering rules applied:
--   • user_engagement_daily → JOIN profiles, exclude is_test_account
--   • opportunities         → JOIN club profile, exclude is_test_account
--   • opportunity_applications → JOIN applicant + club, both non-test
--   • events.user_id        → JOIN profiles, exclude is_test_account
--   • brands                → JOIN owning profile, exclude is_test_account
--   • brand_products/posts  → propagate brand → profile filter
--   • messages              → filter sender non-test (mirrors
--                              admin_get_messaging_metrics)
--   • conversations         → both participants non-test
--   • profile_friendships   → both users non-test
--   • push_subscriptions    → JOIN profile, exclude test
--   • user_devices          → JOIN profile, exclude test
--   • pwa_installs          → kept as-is (anonymous installs are valid;
--                              profile_id is nullable for pre-auth installs)
--
-- Out of scope for this migration:
--   • Cohort bias in admin_get_activation_funnel and admin_get_player_funnel
--     (created_at > v_date_filter denominator includes in-flight signups
--     who have not had time to convert to later steps). This is a
--     methodology decision that visibly changes funnel numbers; tracked
--     separately so the user can review it independently.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. admin_get_engagement_summary
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_engagement_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stats JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT json_build_object(
    'total_active_users_7d', (
      SELECT COUNT(DISTINCT ued.user_id)
      FROM user_engagement_daily ued
      JOIN profiles p ON p.id = ued.user_id
      WHERE ued.date > CURRENT_DATE - 7
        AND NOT p.is_test_account
    ),
    'total_active_users_30d', (
      SELECT COUNT(DISTINCT ued.user_id)
      FROM user_engagement_daily ued
      JOIN profiles p ON p.id = ued.user_id
      WHERE ued.date > CURRENT_DATE - 30
        AND NOT p.is_test_account
    ),
    'total_time_minutes_7d', (
      SELECT COALESCE(SUM(ued.total_seconds) / 60, 0)
      FROM user_engagement_daily ued
      JOIN profiles p ON p.id = ued.user_id
      WHERE ued.date > CURRENT_DATE - 7
        AND NOT p.is_test_account
    ),
    'total_time_minutes_30d', (
      SELECT COALESCE(SUM(ued.total_seconds) / 60, 0)
      FROM user_engagement_daily ued
      JOIN profiles p ON p.id = ued.user_id
      WHERE ued.date > CURRENT_DATE - 30
        AND NOT p.is_test_account
    ),
    'total_sessions_7d', (
      SELECT COALESCE(SUM(ued.session_count), 0)
      FROM user_engagement_daily ued
      JOIN profiles p ON p.id = ued.user_id
      WHERE ued.date > CURRENT_DATE - 7
        AND NOT p.is_test_account
    ),
    'total_sessions_30d', (
      SELECT COALESCE(SUM(ued.session_count), 0)
      FROM user_engagement_daily ued
      JOIN profiles p ON p.id = ued.user_id
      WHERE ued.date > CURRENT_DATE - 30
        AND NOT p.is_test_account
    ),
    'avg_session_minutes', (
      SELECT ROUND(
        COALESCE(AVG(ued.total_seconds)::NUMERIC / NULLIF(AVG(ued.session_count), 0) / 60, 0),
        1
      )
      FROM user_engagement_daily ued
      JOIN profiles p ON p.id = ued.user_id
      WHERE ued.date > CURRENT_DATE - 30
        AND NOT p.is_test_account
    ),
    'avg_daily_active_users', (
      SELECT ROUND(AVG(daily_users)::NUMERIC, 0)
      FROM (
        SELECT ued.date, COUNT(DISTINCT ued.user_id) AS daily_users
        FROM user_engagement_daily ued
        JOIN profiles p ON p.id = ued.user_id
        WHERE ued.date > CURRENT_DATE - 30
          AND NOT p.is_test_account
        GROUP BY ued.date
      ) sub
    ),
    'generated_at', now()
  ) INTO v_stats;

  RETURN v_stats;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_get_engagement_trends
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_engagement_trends(p_days integer DEFAULT 30)
RETURNS TABLE(date date, active_users integer, total_minutes integer, total_sessions integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - p_days,
      CURRENT_DATE,
      '1 day'::INTERVAL
    )::DATE AS date
  ),
  filtered_engagement AS (
    SELECT ued.date, ued.user_id, ued.total_seconds, ued.session_count
    FROM user_engagement_daily ued
    JOIN profiles p ON p.id = ued.user_id
    WHERE NOT p.is_test_account
      AND ued.date BETWEEN CURRENT_DATE - p_days AND CURRENT_DATE
  )
  SELECT
    ds.date,
    COALESCE(COUNT(DISTINCT fe.user_id)::INTEGER, 0) AS active_users,
    COALESCE(SUM(fe.total_seconds)::INTEGER / 60, 0) AS total_minutes,
    COALESCE(SUM(fe.session_count)::INTEGER, 0) AS total_sessions
  FROM date_series ds
  LEFT JOIN filtered_engagement fe ON fe.date = ds.date
  GROUP BY ds.date
  ORDER BY ds.date ASC;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. admin_get_command_center
-- Fixes DAU/WAU/MAU, live opportunities, applications, vacancy_views.
-- profile_completion, role_distribution, d7_retention were already correct.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. admin_get_dashboard_stats
-- Fixes brand metrics, vacancies, applications, conversations, messages,
-- friendships, push subscribers (top-level), device counts.
-- pwa_installs left as-is — anonymous pre-auth installs are valid signal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_dashboard_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stats JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT json_build_object(
    -- User metrics
    'total_users', (SELECT COUNT(*) FROM profiles WHERE NOT is_test_account),
    'total_players', (SELECT COUNT(*) FROM profiles WHERE role = 'player' AND NOT is_test_account),
    'total_coaches', (SELECT COUNT(*) FROM profiles WHERE role = 'coach' AND NOT is_test_account),
    'total_clubs', (SELECT COUNT(*) FROM profiles WHERE role = 'club' AND NOT is_test_account),
    'blocked_users', (SELECT COUNT(*) FROM profiles WHERE is_blocked = true),
    'test_accounts', (SELECT COUNT(*) FROM profiles WHERE is_test_account = true),

    -- Brand metrics — owning profile must be non-test
    'total_brands', (
      SELECT COUNT(*) FROM brands b
      JOIN profiles p ON p.id = b.profile_id
      WHERE b.deleted_at IS NULL AND NOT p.is_test_account
    ),
    'brands_7d', (
      SELECT COUNT(*) FROM brands b
      JOIN profiles p ON p.id = b.profile_id
      WHERE b.created_at > now() - interval '7 days'
        AND b.deleted_at IS NULL
        AND NOT p.is_test_account
    ),
    'total_brand_products', (
      SELECT COUNT(*) FROM brand_products bp
      JOIN brands b ON b.id = bp.brand_id
      JOIN profiles p ON p.id = b.profile_id
      WHERE bp.deleted_at IS NULL
        AND b.deleted_at IS NULL
        AND NOT p.is_test_account
    ),
    'total_brand_posts', (
      SELECT COUNT(*) FROM brand_posts bpost
      JOIN brands b ON b.id = bpost.brand_id
      JOIN profiles p ON p.id = b.profile_id
      WHERE bpost.deleted_at IS NULL
        AND b.deleted_at IS NULL
        AND NOT p.is_test_account
    ),

    -- Signups
    'signups_7d', (SELECT COUNT(*) FROM profiles WHERE created_at > now() - interval '7 days' AND NOT is_test_account),
    'signups_30d', (SELECT COUNT(*) FROM profiles WHERE created_at > now() - interval '30 days' AND NOT is_test_account),

    -- Onboarding
    'onboarding_completed', (SELECT COUNT(*) FROM profiles WHERE onboarding_completed = true AND NOT is_test_account),
    'onboarding_pending', (SELECT COUNT(*) FROM profiles WHERE onboarding_completed = false AND NOT is_test_account),

    -- Vacancies — club must be non-test
    'total_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE NOT p.is_test_account
    ),
    'open_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.status = 'open' AND NOT p.is_test_account
    ),
    'closed_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.status = 'closed' AND NOT p.is_test_account
    ),
    'draft_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.status = 'draft' AND NOT p.is_test_account
    ),
    'vacancies_7d', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.created_at > now() - interval '7 days'
        AND NOT p.is_test_account
    ),

    -- Applications — applicant AND club non-test
    'total_applications', (
      SELECT COUNT(*) FROM opportunity_applications oa
      JOIN profiles applicant ON applicant.id = oa.applicant_id
      JOIN opportunities o ON o.id = oa.opportunity_id
      JOIN profiles club ON club.id = o.club_id
      WHERE NOT applicant.is_test_account AND NOT club.is_test_account
    ),
    'pending_applications', (
      SELECT COUNT(*) FROM opportunity_applications oa
      JOIN profiles applicant ON applicant.id = oa.applicant_id
      JOIN opportunities o ON o.id = oa.opportunity_id
      JOIN profiles club ON club.id = o.club_id
      WHERE oa.status = 'pending'
        AND NOT applicant.is_test_account
        AND NOT club.is_test_account
    ),
    'applications_7d', (
      SELECT COUNT(*) FROM opportunity_applications oa
      JOIN profiles applicant ON applicant.id = oa.applicant_id
      JOIN opportunities o ON o.id = oa.opportunity_id
      JOIN profiles club ON club.id = o.club_id
      WHERE oa.applied_at > now() - interval '7 days'
        AND NOT applicant.is_test_account
        AND NOT club.is_test_account
    ),

    -- Engagement: messages by sender; conversations + friendships by both sides
    'total_conversations', (
      SELECT COUNT(*) FROM conversations c
      JOIN profiles p1 ON p1.id = c.participant_one_id
      JOIN profiles p2 ON p2.id = c.participant_two_id
      WHERE NOT p1.is_test_account AND NOT p2.is_test_account
    ),
    'total_messages', (
      SELECT COUNT(*) FROM messages m
      JOIN profiles p ON p.id = m.sender_id
      WHERE NOT p.is_test_account
    ),
    'messages_7d', (
      SELECT COUNT(*) FROM messages m
      JOIN profiles p ON p.id = m.sender_id
      WHERE m.sent_at > now() - interval '7 days'
        AND NOT p.is_test_account
    ),
    'total_friendships', (
      SELECT COUNT(*) FROM profile_friendships f
      JOIN profiles p1 ON p1.id = f.user_one
      JOIN profiles p2 ON p2.id = f.user_two
      WHERE f.status = 'accepted'
        AND NOT p1.is_test_account
        AND NOT p2.is_test_account
    ),

    -- Data health (auth ↔ profile orphans — unfiltered by design)
    'auth_orphans', (
      SELECT COUNT(*)
      FROM auth.users au
      LEFT JOIN profiles p ON p.id = au.id
      WHERE p.id IS NULL
    ),
    'profile_orphans', (
      SELECT COUNT(*)
      FROM profiles p
      LEFT JOIN auth.users au ON au.id = p.id
      WHERE au.id IS NULL
    ),

    -- Push notification metrics (top-level: now filters test)
    'push_subscribers', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE NOT p.is_test_account
    ),
    'push_subscribers_player', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'player' AND NOT p.is_test_account
    ),
    'push_subscribers_coach', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'coach' AND NOT p.is_test_account
    ),
    'push_subscribers_club', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'club' AND NOT p.is_test_account
    ),
    'push_subscribers_brand', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'brand' AND NOT p.is_test_account
    ),

    -- PWA installs: kept as-is. profile_id is nullable for pre-auth
    -- installs (e.g. tracked from anon visitor). Filtering would lose
    -- this signal; test-account inflation here is bounded because
    -- pre-auth installs cannot be marked test.
    'pwa_installs', (SELECT COUNT(*) FROM pwa_installs),
    'pwa_installs_ios', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'ios'),
    'pwa_installs_android', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'android'),
    'pwa_installs_desktop', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'desktop'),

    -- Device tracking — exclude test
    'device_users_ios', (
      SELECT COUNT(DISTINCT ud.profile_id)
      FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.platform = 'ios' AND NOT p.is_test_account
    ),
    'device_users_android', (
      SELECT COUNT(DISTINCT ud.profile_id)
      FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.platform = 'android' AND NOT p.is_test_account
    ),
    'device_users_desktop', (
      SELECT COUNT(DISTINCT ud.profile_id)
      FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.platform = 'desktop' AND NOT p.is_test_account
    ),
    'device_users_pwa', (
      SELECT COUNT(DISTINCT ud.profile_id)
      FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.is_pwa = true AND NOT p.is_test_account
    ),
    'device_users_multi_platform', (
      SELECT COUNT(*) FROM (
        SELECT ud.profile_id
        FROM user_devices ud
        JOIN profiles p ON p.id = ud.profile_id
        WHERE NOT p.is_test_account
        GROUP BY ud.profile_id
        HAVING COUNT(*) > 1
      ) mp
    ),

    'generated_at', now()
  ) INTO v_stats;

  RETURN v_stats;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. admin_get_brand_activity
-- Filter listed brands by owning profile non-test. Product/post counts are
-- already scoped to the listed brand_id, so excluding test brands at the
-- list level naturally fixes the counts too.
-- LEFT JOIN preserved + COALESCE so brands with missing profile_id still
-- pass through (they cannot be flagged test).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_brand_activity(p_days integer DEFAULT 30, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE(brand_id uuid, brand_name text, logo_url text, category text, slug text, is_verified boolean, product_count bigint, post_count bigint, last_activity_at timestamp with time zone, onboarding_completed boolean, created_at timestamp with time zone, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total BIGINT;
  v_date_filter TIMESTAMPTZ;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_date_filter := CASE
    WHEN p_days IS NULL THEN '-infinity'::TIMESTAMPTZ
    ELSE now() - (p_days || ' days')::INTERVAL
  END;

  SELECT COUNT(*) INTO v_total
  FROM brands b
  LEFT JOIN profiles p ON p.id = b.profile_id
  WHERE b.deleted_at IS NULL
    AND b.created_at > v_date_filter
    AND COALESCE(p.is_test_account, false) = false;

  RETURN QUERY
  SELECT
    b.id,
    b.name,
    b.logo_url,
    b.category,
    b.slug,
    COALESCE(p.is_verified, false),
    COALESCE(bp_count.cnt, 0)::BIGINT,
    COALESCE(bpost_count.cnt, 0)::BIGINT,
    GREATEST(b.updated_at, bp_count.last_at, bpost_count.last_at),
    COALESCE(p.onboarding_completed, false),
    b.created_at,
    v_total
  FROM brands b
  LEFT JOIN profiles p ON p.id = b.profile_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt, MAX(bp.created_at) AS last_at
    FROM brand_products bp
    WHERE bp.brand_id = b.id AND bp.deleted_at IS NULL
  ) bp_count ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt, MAX(bpost.created_at) AS last_at
    FROM brand_posts bpost
    WHERE bpost.brand_id = b.id AND bpost.deleted_at IS NULL
  ) bpost_count ON true
  WHERE b.deleted_at IS NULL
    AND b.created_at > v_date_filter
    AND COALESCE(p.is_test_account, false) = false
  ORDER BY (COALESCE(bp_count.cnt, 0) + COALESCE(bpost_count.cnt, 0)) DESC, b.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions: re-grant after CREATE OR REPLACE (Postgres preserves grants
-- on REPLACE, but explicit grants here document the contract).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_get_engagement_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_engagement_trends(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_command_center(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_dashboard_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_brand_activity(integer, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_engagement_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_engagement_trends(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_command_center(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_brand_activity(integer, integer, integer) TO authenticated;
