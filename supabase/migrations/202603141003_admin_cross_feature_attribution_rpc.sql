-- Cross-Feature Attribution Analytics RPC
-- Measures conversion between features using time-window correlation

CREATE OR REPLACE FUNCTION admin_get_cross_feature_attribution(
  p_days INT DEFAULT 30,
  p_window_hours INT DEFAULT 24,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_window INTERVAL := (p_window_hours || ' hours')::INTERVAL;
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
  -- Profile views in period
  profile_views AS (
    SELECT user_id, entity_id, created_at
    FROM events
    WHERE event_name = 'profile_view'
      AND entity_type = 'profile'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Messages sent in period
  messages_sent AS (
    SELECT user_id, entity_id AS conversation_id, created_at
    FROM events
    WHERE event_name = 'message_send'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Friend requests in period
  friend_requests AS (
    SELECT user_id, created_at
    FROM events
    WHERE event_name = 'friend_request_send'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Vacancy views
  vacancy_views AS (
    SELECT user_id, entity_id, created_at
    FROM events
    WHERE event_name = 'vacancy_view'
      AND entity_type = 'vacancy'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Applications
  applications AS (
    SELECT user_id, entity_id, created_at
    FROM events
    WHERE event_name = 'application_submit'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Notification clicks
  notif_clicks AS (
    SELECT user_id, properties->>'kind' AS kind, created_at
    FROM events
    WHERE event_name = 'notification_click'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),

  -- Profile view → message (viewed profile then messaged within window)
  pv_to_msg AS (
    SELECT COUNT(DISTINCT pv.user_id) AS converted_users
    FROM profile_views pv
    WHERE EXISTS (
      SELECT 1 FROM messages_sent ms
      WHERE ms.user_id = pv.user_id
        AND ms.created_at > pv.created_at
        AND ms.created_at <= pv.created_at + v_window
    )
  ),
  -- Profile view → friend request
  pv_to_friend AS (
    SELECT COUNT(DISTINCT pv.user_id) AS converted_users
    FROM profile_views pv
    WHERE EXISTS (
      SELECT 1 FROM friend_requests fr
      WHERE fr.user_id = pv.user_id
        AND fr.created_at > pv.created_at
        AND fr.created_at <= pv.created_at + v_window
    )
  ),
  -- Vacancy view → application
  vv_to_app AS (
    SELECT COUNT(DISTINCT vv.user_id) AS converted_users
    FROM vacancy_views vv
    WHERE EXISTS (
      SELECT 1 FROM applications a
      WHERE a.user_id = vv.user_id
        AND a.entity_id = vv.entity_id
        AND a.created_at > vv.created_at
        AND a.created_at <= vv.created_at + v_window
    )
  ),
  -- Notification click → any action within window
  notif_to_action AS (
    SELECT
      nc.kind,
      COUNT(DISTINCT nc.user_id) AS clickers,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM events e2
        WHERE e2.user_id = nc.user_id
          AND e2.event_name IN ('message_send', 'application_submit', 'friend_request_send', 'post_create', 'profile_view')
          AND e2.created_at > nc.created_at
          AND e2.created_at <= nc.created_at + INTERVAL '1 hour'
      ) THEN nc.user_id END) AS action_takers
    FROM notif_clicks nc
    GROUP BY nc.kind
  )
  SELECT jsonb_build_object(
    'profile_view_to_message', jsonb_build_object(
      'total_profile_viewers', (SELECT COUNT(DISTINCT user_id) FROM profile_views),
      'converted_to_message', (SELECT converted_users FROM pv_to_msg),
      'conversion_rate', CASE
        WHEN (SELECT COUNT(DISTINCT user_id) FROM profile_views) > 0
        THEN ROUND(((SELECT converted_users FROM pv_to_msg) * 100.0 /
              (SELECT COUNT(DISTINCT user_id) FROM profile_views))::numeric, 1)
        ELSE 0
      END
    ),
    'profile_view_to_friend', jsonb_build_object(
      'total_profile_viewers', (SELECT COUNT(DISTINCT user_id) FROM profile_views),
      'converted_to_friend_request', (SELECT converted_users FROM pv_to_friend),
      'conversion_rate', CASE
        WHEN (SELECT COUNT(DISTINCT user_id) FROM profile_views) > 0
        THEN ROUND(((SELECT converted_users FROM pv_to_friend) * 100.0 /
              (SELECT COUNT(DISTINCT user_id) FROM profile_views))::numeric, 1)
        ELSE 0
      END
    ),
    'vacancy_view_to_application', jsonb_build_object(
      'total_vacancy_viewers', (SELECT COUNT(DISTINCT user_id) FROM vacancy_views),
      'converted_to_application', (SELECT converted_users FROM vv_to_app),
      'conversion_rate', CASE
        WHEN (SELECT COUNT(DISTINCT user_id) FROM vacancy_views) > 0
        THEN ROUND(((SELECT converted_users FROM vv_to_app) * 100.0 /
              (SELECT COUNT(DISTINCT user_id) FROM vacancy_views))::numeric, 1)
        ELSE 0
      END
    ),
    'notification_to_action', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'kind', kind,
        'clickers', clickers,
        'action_takers', action_takers,
        'action_rate', CASE WHEN clickers > 0
          THEN ROUND((action_takers * 100.0 / clickers)::numeric, 1) ELSE 0 END
      )) FROM notif_to_action),
      '[]'::jsonb
    ),
    'window_hours', p_window_hours
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_cross_feature_attribution TO authenticated;
