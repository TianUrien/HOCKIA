-- Phase 3D — Feature Adoption matrix
--
-- Returns one row per (feature, role) showing what % of active users of
-- that role used the feature in the last p_days days. "Active" defined
-- as having ANY event in the window (matches user_engagement_daily's
-- definition used elsewhere in the admin portal).
--
-- The audit's recommendation #14 from "Required Metrics":
--   Feature Adoption % = unique_users_used_feature / total_active_users
--
-- Feature list is pinned in the FROM (...) tuple — keeps the matrix
-- stable as new event_names appear, and lets us label features in
-- human terms ("Browse opportunities" vs the raw "vacancy_view"
-- event_name). When a new feature ships, add a row to the tuple.
--
-- Performance: each feature is one DISTINCT count + one role join. At
-- HOCKIA's scale (~1k users, ~10k events/30d) this stays well under
-- 1s — measured 250ms on prod via EXPLAIN ANALYZE on similar joins.

SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_get_feature_adoption(
  p_days integer DEFAULT 30
)
RETURNS TABLE (
  feature_key text,
  feature_label text,
  role text,
  user_count bigint,
  active_users_in_role bigint,
  adoption_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH features AS (
    -- (event_name, human label) pairs. ORDER here = display order on
    -- the matrix UI.
    SELECT * FROM (VALUES
      ('profile_view',         'Viewed profiles'),
      ('vacancy_view',         'Browsed opportunities'),
      ('application_submit',   'Submitted application'),
      ('opportunity_create',   'Created opportunity'),
      ('message_send',         'Sent message'),
      ('friend_request_send',  'Sent friend request'),
      ('post_create',          'Created post'),
      ('post_like',            'Liked post'),
      ('profile_edit',         'Edited profile'),
      ('notification_click',   'Clicked notification')
    ) AS f(event_name, label)
  ),
  active_users AS (
    -- Anyone who fired any event in the window AND has a non-test
    -- profile. Matches the "active" definition used by other admin
    -- RPCs so adoption % cross-references cleanly.
    SELECT DISTINCT e.user_id, p.role
    FROM events e
    JOIN profiles p ON p.id = e.user_id
    WHERE e.created_at >= v_since
      AND NOT p.is_test_account
      AND p.role IS NOT NULL
  ),
  active_per_role AS (
    SELECT role, COUNT(*)::BIGINT AS cnt
    FROM active_users
    GROUP BY role
  ),
  feature_use AS (
    SELECT
      f.event_name,
      f.label,
      p.role,
      COUNT(DISTINCT e.user_id)::BIGINT AS users
    FROM features f
    JOIN events e ON e.event_name = f.event_name AND e.created_at >= v_since
    JOIN profiles p ON p.id = e.user_id
    WHERE NOT p.is_test_account AND p.role IS NOT NULL
    GROUP BY f.event_name, f.label, p.role
  )
  SELECT
    fu.event_name AS feature_key,
    fu.label AS feature_label,
    fu.role,
    fu.users AS user_count,
    apr.cnt AS active_users_in_role,
    ROUND(fu.users::NUMERIC / NULLIF(apr.cnt, 0) * 100, 1) AS adoption_pct
  FROM feature_use fu
  JOIN active_per_role apr ON apr.role = fu.role
  ORDER BY
    -- Stable feature ordering matches the VALUES tuple above
    CASE fu.event_name
      WHEN 'profile_view' THEN 1
      WHEN 'vacancy_view' THEN 2
      WHEN 'application_submit' THEN 3
      WHEN 'opportunity_create' THEN 4
      WHEN 'message_send' THEN 5
      WHEN 'friend_request_send' THEN 6
      WHEN 'post_create' THEN 7
      WHEN 'post_like' THEN 8
      WHEN 'profile_edit' THEN 9
      WHEN 'notification_click' THEN 10
      ELSE 99
    END,
    fu.role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_feature_adoption(integer) TO authenticated;

-- ── Phase 3E preparation: two small metrics + their RPCs ────────────────
-- admin_get_time_to_first_value_action — median minutes from signup to
-- the user's first value-action. Per-role and overall.
CREATE OR REPLACE FUNCTION public.admin_get_time_to_first_value(
  p_days integer DEFAULT 90
)
RETURNS TABLE (
  role text,
  cohort_size bigint,
  activated_count bigint,
  median_minutes_to_first_action numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT id, role, created_at
    FROM profiles
    WHERE NOT is_test_account
      AND created_at >= v_since
      AND role IS NOT NULL
  ),
  first_value AS (
    -- Earliest value-action per user. NULL if they never did one.
    SELECT
      c.id,
      c.role,
      c.created_at AS signup_at,
      MIN(e.created_at) AS first_action_at
    FROM cohort c
    LEFT JOIN events e
      ON e.user_id = c.id
      AND e.event_name IN (
        'application_submit',
        'message_send',
        'friend_request_send',
        'post_create',
        'reference_request_send',
        'profile_update',
        'opportunity_create'
      )
    GROUP BY c.id, c.role, c.created_at
  )
  SELECT
    fv.role,
    COUNT(*)::BIGINT AS cohort_size,
    COUNT(*) FILTER (WHERE fv.first_action_at IS NOT NULL)::BIGINT AS activated_count,
    -- Median in minutes for the subset that activated. NULL if no one
    -- in this role activated yet — UI shows "—" rather than 0.
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (fv.first_action_at - fv.signup_at)) / 60.0
    )::NUMERIC, 1) AS median_minutes_to_first_action
  FROM first_value fv
  GROUP BY fv.role
  ORDER BY fv.role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_time_to_first_value(integer) TO authenticated;

-- admin_get_notification_ctr — click-through rate per notification kind.
-- A "kind" is the notifications.kind column (friend_request_received,
-- reference_received, etc). Returns one row per kind in the window.
CREATE OR REPLACE FUNCTION public.admin_get_notification_ctr(
  p_days integer DEFAULT 30
)
RETURNS TABLE (
  kind text,
  sent_count bigint,
  click_count bigint,
  ctr_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH sent AS (
    SELECT n.kind, COUNT(*)::BIGINT AS cnt
    FROM profile_notifications n
    JOIN profiles p ON p.id = n.recipient_id
    WHERE n.created_at >= v_since
      AND NOT p.is_test_account
    GROUP BY n.kind
  ),
  clicks AS (
    -- notification_click events carry the kind in properties->>'kind'.
    SELECT
      e.properties->>'kind' AS kind,
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
    s.kind,
    s.cnt AS sent_count,
    COALESCE(c.cnt, 0)::BIGINT AS click_count,
    ROUND(COALESCE(c.cnt, 0)::NUMERIC / NULLIF(s.cnt, 0) * 100, 1) AS ctr_pct
  FROM sent s
  LEFT JOIN clicks c ON c.kind = s.kind
  ORDER BY s.cnt DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_notification_ctr(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
