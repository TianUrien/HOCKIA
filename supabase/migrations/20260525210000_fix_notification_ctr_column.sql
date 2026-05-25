-- Repair migration: admin_get_notification_ctr (Phase 3E) referenced
-- profile_notifications.recipient_id, but the actual column is
-- recipient_profile_id. Result: the RPC threw on every call, the
-- frontend catch handler swallowed the error, and the
-- NotificationCtrCard on Overview rendered its empty state ("No
-- notifications sent in the last 30 days") even though staging had
-- 68 sends in scope.
--
-- Caught by the QA agent's full audit pass on 2026-05-25. The agent
-- correctly identified that the data layer worked elsewhere (the
-- Activation tab's Notification Effectiveness card showed real CTR
-- numbers from a different RPC), narrowing the bug to this surface.

SET search_path = public;

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
    JOIN profiles p ON p.id = n.recipient_profile_id  -- was: n.recipient_id
    WHERE n.created_at >= v_since
      AND NOT p.is_test_account
    GROUP BY n.kind
  ),
  clicks AS (
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

NOTIFY pgrst, 'reload schema';
