-- Fix column reference in notification_effectiveness and conversion_funnels RPCs
-- recipient_id → recipient_profile_id (actual column name in profile_notifications)

-- ============================================================================
-- 1. FIX: NOTIFICATION EFFECTIVENESS
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_notification_effectiveness(
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
  -- Notifications created per kind
  notif_created AS (
    SELECT
      kind,
      COUNT(*) AS created,
      COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read,
      COUNT(*) FILTER (WHERE cleared_at IS NOT NULL) AS cleared
    FROM profile_notifications
    WHERE created_at >= v_since
      AND recipient_profile_id NOT IN (SELECT id FROM test_ids)
    GROUP BY kind
  ),
  -- Click-through events from events table
  notif_clicks AS (
    SELECT
      properties->>'kind' AS kind,
      COUNT(*) AS clicks,
      COUNT(DISTINCT user_id) AS unique_clickers
    FROM events
    WHERE event_name = 'notification_click'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
    GROUP BY properties->>'kind'
  ),
  -- Combined per kind
  per_kind AS (
    SELECT
      nc.kind,
      nc.created,
      nc.read,
      nc.cleared,
      COALESCE(nk.clicks, 0) AS clicks,
      COALESCE(nk.unique_clickers, 0) AS unique_clickers,
      CASE WHEN nc.created > 0 THEN ROUND((nc.read::numeric / nc.created) * 100, 1) ELSE 0 END AS read_rate,
      CASE WHEN nc.created > 0 THEN ROUND((COALESCE(nk.clicks, 0)::numeric / nc.created) * 100, 1) ELSE 0 END AS click_rate
    FROM notif_created nc
    LEFT JOIN notif_clicks nk ON nk.kind = nc.kind::text
    ORDER BY nc.created DESC
  ),
  -- Overall totals
  totals AS (
    SELECT
      SUM(created) AS total_created,
      SUM(read) AS total_read,
      SUM(clicks) AS total_clicks
    FROM per_kind
  ),
  -- Daily trend
  daily_trend AS (
    SELECT
      d.day::date AS day,
      COALESCE(n.created, 0) AS created,
      COALESCE(n.read, 0) AS read,
      COALESCE(c.clicks, 0) AS clicks
    FROM generate_series(v_since::date, CURRENT_DATE, '1 day') AS d(day)
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS created, COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read
      FROM profile_notifications
      WHERE created_at >= v_since AND recipient_profile_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) n ON n.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS clicks
      FROM events
      WHERE event_name = 'notification_click' AND created_at >= v_since
        AND user_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) c ON c.day = d.day
    ORDER BY d.day
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
      'total_created', COALESCE(total_created, 0),
      'total_read', COALESCE(total_read, 0),
      'total_clicks', COALESCE(total_clicks, 0),
      'overall_read_rate', CASE WHEN COALESCE(total_created, 0) > 0 THEN ROUND((COALESCE(total_read, 0)::numeric / total_created) * 100, 1) ELSE 0 END,
      'overall_click_rate', CASE WHEN COALESCE(total_created, 0) > 0 THEN ROUND((COALESCE(total_clicks, 0)::numeric / total_created) * 100, 1) ELSE 0 END
    ) FROM totals),
    'per_kind', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'kind', kind, 'created', created, 'read', read, 'cleared', cleared,
      'clicks', clicks, 'unique_clickers', unique_clickers,
      'read_rate', read_rate, 'click_rate', click_rate
    )) FROM per_kind), '[]'::jsonb),
    'daily_trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'created', created, 'read', read, 'clicks', clicks)) FROM daily_trend), '[]'::jsonb),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 2. FIX: CONVERSION FUNNELS (notification section)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_conversion_funnels(
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
  -- Profile View → Friend Request funnel
  profile_viewers AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'profile_view'
      AND created_at >= v_since
      AND user_id IS NOT NULL
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  friend_requesters AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'friend_request_send'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  friend_accepted AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'friend_request_update'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND properties->>'status' = 'accepted'
  ),
  -- Vacancy View → Application funnel
  vacancy_viewers AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'vacancy_view'
      AND created_at >= v_since
      AND user_id IS NOT NULL
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  applicants AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'application_submit'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  shortlisted AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'applicant_status_change'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND properties->>'new_status' = 'shortlisted'
  ),
  -- Notification → Click funnel
  notif_recipients AS (
    SELECT DISTINCT recipient_profile_id AS user_id
    FROM profile_notifications
    WHERE created_at >= v_since
      AND recipient_profile_id NOT IN (SELECT id FROM test_ids)
  ),
  notif_readers AS (
    SELECT DISTINCT recipient_profile_id AS user_id
    FROM profile_notifications
    WHERE created_at >= v_since
      AND read_at IS NOT NULL
      AND recipient_profile_id NOT IN (SELECT id FROM test_ids)
  ),
  notif_clickers AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'notification_click'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Reference funnel
  ref_requesters AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'reference_request'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  ref_accepted AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'reference_respond'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND (properties->>'accepted')::boolean = true
  )
  SELECT jsonb_build_object(
    'networking_funnel', jsonb_build_object(
      'profile_viewers', (SELECT COUNT(*) FROM profile_viewers),
      'friend_requesters', (SELECT COUNT(*) FROM friend_requesters),
      'friend_accepted', (SELECT COUNT(*) FROM friend_accepted)
    ),
    'opportunity_funnel', jsonb_build_object(
      'vacancy_viewers', (SELECT COUNT(*) FROM vacancy_viewers),
      'applicants', (SELECT COUNT(*) FROM applicants),
      'shortlisted', (SELECT COUNT(*) FROM shortlisted)
    ),
    'notification_funnel', jsonb_build_object(
      'recipients', (SELECT COUNT(*) FROM notif_recipients),
      'readers', (SELECT COUNT(*) FROM notif_readers),
      'clickers', (SELECT COUNT(*) FROM notif_clickers)
    ),
    'reference_funnel', jsonb_build_object(
      'requesters', (SELECT COUNT(*) FROM ref_requesters),
      'accepted', (SELECT COUNT(*) FROM ref_accepted)
    ),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;
