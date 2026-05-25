-- QA pass 3 fixes (2026-05-25):
--   1. admin_get_time_to_first_value still throws "column reference 'role'
--      is ambiguous". The previous migration (20260525220000) renamed the
--      SELECT alias but left `role IS NOT NULL` unqualified in the WHERE
--      clause. PG resolves that unqualified `role` to the OUT-param,
--      not to profiles.role, hence the ambiguity. Qualify it explicitly.
--      Verified by reproducing the exact deployed body with
--      `profiles.role IS NOT NULL` — succeeds — and with bare `role IS
--      NOT NULL` — throws.
--
--   2. admin_get_notification_ctr returned 200% CTR for a kind where one
--      user clicked the same notification kind twice (sent=1, clicked=2,
--      raw ratio 200%). Same class as the old 125% Opportunity Funnel
--      bug. The underlying counts are real (click events can outnumber
--      sends when a user clicks multiple links in the same email), but
--      "200%" reads as broken. Cap pct at 100 in the SQL so the data
--      surface protects itself even when counts diverge.

SET search_path = public;

-- ── 1. admin_get_time_to_first_value (qualified WHERE) ──────────────────
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
    -- `profiles.role` (not bare `role`) in BOTH the SELECT and the WHERE,
    -- so neither can resolve to the RETURNS-TABLE OUT-param `role`.
    -- Previous fix renamed the SELECT alias but missed the WHERE.
    SELECT id AS p_id, profiles.role::text AS r_role, created_at AS signup_at
    FROM profiles
    WHERE NOT is_test_account
      AND created_at >= v_since
      AND profiles.role IS NOT NULL
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

-- ── 2. admin_get_notification_ctr (cap pct at 100) ──────────────────────
-- LEAST(…, 100) on the computed pct. Raw counts stay accurate so admins
-- can still see when click_count > sent_count (signal that a user is
-- clicking the same notification multiple times). The percentage is
-- what was misleading at >100%.
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
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_notification_ctr(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
