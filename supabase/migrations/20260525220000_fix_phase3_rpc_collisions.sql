-- Repair migration for 3 Phase 3 RPCs caught by the QA agent's second pass
-- (2026-05-25). The bugs all involve mismatches between PG types / OUT
-- parameter names and the inner CTE queries. None showed up in my inline
-- SQL tests because the tests used SELECT statements which don't
-- compile through plpgsql RETURNS TABLE's OUT-param shadowing.
--
--   1. admin_get_time_to_first_value — RETURNS TABLE (role text, …);
--      the inner CTE selects unqualified `role` from profiles, which
--      collides with the OUT-param `role`. PG errors with
--      "column reference 'role' is ambiguous". Same shape in
--      admin_get_feature_adoption.
--
--   2. admin_get_notification_ctr — profile_notifications.kind is a
--      profile_notification_kind enum; events.properties->>'kind'
--      returns text. The LEFT JOIN `c.kind = s.kind` compares text
--      to enum and PG errors with "operator does not exist:
--      text = profile_notification_kind". Need cast on the join.
--
-- Fix strategy:
--   - For #1 + #3, rename the inner CTE columns away from the OUT-param
--     names (`_role` → unmistakable).
--   - For #2, cast on the join key.

SET search_path = public;

-- ── 1. admin_get_time_to_first_value ─────────────────────────────────────
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
    -- Renamed `role` → `r_role` so the column does not collide with the
    -- OUT-parameter named `role`. Same for subsequent CTEs.
    SELECT id AS p_id, role::text AS r_role, created_at AS signup_at
    FROM profiles
    WHERE NOT is_test_account
      AND created_at >= v_since
      AND role IS NOT NULL
  ),
  first_value AS (
    SELECT
      c.p_id,
      c.r_role,
      c.signup_at,
      MIN(e.created_at) AS first_action_at
    FROM cohort c
    LEFT JOIN events e
      ON e.user_id = c.p_id
      AND e.event_name IN (
        'application_submit',
        'message_send',
        'friend_request_send',
        'post_create',
        'reference_request_send',
        'profile_update',
        'opportunity_create'
      )
    GROUP BY c.p_id, c.r_role, c.signup_at
  )
  SELECT
    fv.r_role::text,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE fv.first_action_at IS NOT NULL)::BIGINT,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (fv.first_action_at - fv.signup_at)) / 60.0
    )::NUMERIC, 1)
  FROM first_value fv
  GROUP BY fv.r_role
  ORDER BY fv.r_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_time_to_first_value(integer) TO authenticated;

-- ── 2. admin_get_notification_ctr ────────────────────────────────────────
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
    -- Cast enum to text in the SELECT so downstream comparisons are
    -- text-vs-text. Could equivalently cast on the join below; doing
    -- it here once is cleaner.
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
    s.k,  -- selected as text → matches RETURNS TABLE `kind text`
    s.cnt,
    COALESCE(c.cnt, 0)::BIGINT,
    ROUND(COALESCE(c.cnt, 0)::NUMERIC / NULLIF(s.cnt, 0) * 100, 1)
  FROM sent s
  LEFT JOIN clicks c ON c.k = s.k
  ORDER BY s.cnt DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_notification_ctr(integer) TO authenticated;

-- ── 3. admin_get_feature_adoption ────────────────────────────────────────
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
  -- Renamed inner `role` → `r_role` so unqualified references don't
  -- collide with the RETURNS TABLE OUT-param named `role`. Same bug
  -- class as admin_get_time_to_first_value above; the agent caught
  -- both with the same error message.
  active_users AS (
    SELECT DISTINCT e.user_id AS u_id, p.role::text AS r_role
    FROM events e
    JOIN profiles p ON p.id = e.user_id
    WHERE e.created_at >= v_since
      AND NOT p.is_test_account
      AND p.role IS NOT NULL
  ),
  active_per_role AS (
    SELECT au.r_role, COUNT(*)::BIGINT AS cnt
    FROM active_users au
    GROUP BY au.r_role
  ),
  feature_use AS (
    SELECT
      f.event_name AS f_key,
      f.label AS f_label,
      p.role::text AS r_role,
      COUNT(DISTINCT e.user_id)::BIGINT AS users
    FROM features f
    JOIN events e ON e.event_name = f.event_name AND e.created_at >= v_since
    JOIN profiles p ON p.id = e.user_id
    WHERE NOT p.is_test_account AND p.role IS NOT NULL
    GROUP BY f.event_name, f.label, p.role
  )
  SELECT
    fu.f_key,
    fu.f_label,
    fu.r_role,
    fu.users,
    apr.cnt,
    ROUND(fu.users::NUMERIC / NULLIF(apr.cnt, 0) * 100, 1)
  FROM feature_use fu
  JOIN active_per_role apr ON apr.r_role = fu.r_role
  ORDER BY
    CASE fu.f_key
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
    fu.r_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_feature_adoption(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
