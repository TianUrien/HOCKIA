-- ─────────────────────────────────────────────────────────────────────
-- WHO-MESSAGES-WHOM: directional sender_role × recipient_role matrix + a
-- daily new-conversation trend, for the Admin Messaging Health page. This
-- closes the marketplace-direction blind spot: volume is tracked, but not
-- whether clubs/coaches actually reach OUT to players (vs only players
-- messaging clubs). Derivable from existing data — no new tracking.
--
-- Returns JSONB:
--   role_pairs: [{sender_role, recipient_role, message_count, conversation_count}]
--               directional — club→player and player→club are separate rows.
--   new_conversations_trend: [{date, count}]  (conversations.created_at by day)
-- Test accounts excluded (any conversation with a test participant is dropped);
-- null roles bucket as 'unknown'.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_messaging_role_pairs(
  p_days INT DEFAULT 30,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
  v_role_pairs JSONB;
  v_new_conv_trend JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Directional matrix: per message, sender_role × the OTHER participant's role.
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.message_count DESC), '[]'::jsonb)
  INTO v_role_pairs
  FROM (
    SELECT
      COALESCE(sender.role, 'unknown') AS sender_role,
      COALESCE(recipient.role, 'unknown') AS recipient_role,
      COUNT(DISTINCT m.id) AS message_count,
      COUNT(DISTINCT m.conversation_id) AS conversation_count
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN profiles sender ON sender.id = m.sender_id
    JOIN profiles recipient ON recipient.id = CASE
      WHEN c.participant_one_id = m.sender_id THEN c.participant_two_id
      ELSE c.participant_one_id
    END
    WHERE m.sent_at >= v_since
      AND (NOT p_exclude_test OR (
        COALESCE(sender.is_test_account, false) = false
        AND COALESCE(recipient.is_test_account, false) = false
      ))
    GROUP BY 1, 2
  ) sub;

  -- Daily NEW conversations (by created_at).
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.date), '[]'::jsonb)
  INTO v_new_conv_trend
  FROM (
    SELECT
      c.created_at::date AS date,
      COUNT(*) AS count
    FROM conversations c
    JOIN profiles p1 ON p1.id = c.participant_one_id
    JOIN profiles p2 ON p2.id = c.participant_two_id
    WHERE c.created_at >= v_since
      AND (NOT p_exclude_test OR (
        COALESCE(p1.is_test_account, false) = false
        AND COALESCE(p2.is_test_account, false) = false
      ))
    GROUP BY c.created_at::date
    ORDER BY c.created_at::date
  ) sub;

  RETURN jsonb_build_object(
    'role_pairs', v_role_pairs,
    'new_conversations_trend', v_new_conv_trend,
    'period_days', p_days,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_messaging_role_pairs(INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_messaging_role_pairs(INT, BOOLEAN) TO authenticated;
