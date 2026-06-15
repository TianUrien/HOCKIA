-- ─────────────────────────────────────────────────────────────────────
-- Admin Portal — privacy-safe per-conversation analytics table.
--
-- Founder ask: "which user messaged which user" — to see whether HOCKIA is
-- creating real connections (clubs → players, players replying, etc).
-- PRIVACY RULE (hard): the Admin Portal must NEVER show message content.
-- This RPC returns ONLY metadata — participants, roles, timestamps, counts,
-- reply flag, time-to-reply, status, origin. No message text, ever.
--
-- Also adds conversations.origin (where the conversation started) so the
-- table can show a Source column. It defaults 'unknown'; populating it from
-- the message entry points is a separate, forward-looking change (B2).
-- ─────────────────────────────────────────────────────────────────────

-- ── Origin column (additive; inherits the table's existing grants) ────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'unknown'
  CHECK (origin IN ('Community', 'Profile', 'Opportunity', 'Hockia AI', 'Direct', 'unknown'));

COMMENT ON COLUMN public.conversations.origin IS
  'Where the conversation was initiated: Community (forum), Profile (visit card), Opportunity (vacancy/apply), Hockia AI (AI mediation), Direct (generic DM), or unknown (pre-instrumentation / unattributed).';

-- ── admin_get_conversations — metadata only, paginated ────────────────
CREATE OR REPLACE FUNCTION public.admin_get_conversations(
  p_days INT DEFAULT 30,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_filters JSONB DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  sender_id UUID,
  sender_name TEXT,
  sender_role TEXT,
  recipient_id UUID,
  recipient_name TEXT,
  recipient_role TEXT,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  message_count BIGINT,
  replied BOOLEAN,
  time_to_first_reply_minutes NUMERIC,
  status TEXT,
  origin TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since  TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_status TEXT := NULLIF(p_filters ->> 'status', '');
  v_origin TEXT := NULLIF(p_filters ->> 'origin', '');
  v_role   TEXT := NULLIF(p_filters ->> 'role', '');
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH test_ids AS (
    SELECT id FROM profiles WHERE COALESCE(is_test_account, false) = true
  ),
  -- Non-test conversations created in the window.
  base AS (
    SELECT
      c.id,
      c.participant_one_id AS p1,
      c.participant_two_id AS p2,
      c.created_at,
      c.last_message_at,
      COALESCE(c.origin, 'unknown') AS origin
    FROM conversations c
    WHERE c.created_at >= v_since
      AND c.participant_one_id NOT IN (SELECT id FROM test_ids)
      AND c.participant_two_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Per-conversation message rollup. INNER JOIN drops empty conversations
  -- (no messages). Deleted messages are kept (consistent with the existing
  -- messaging-health analytics) — they still represent that a user engaged.
  -- NOTE: m.content is never selected — privacy rule.
  msg_agg AS (
    SELECT
      m.conversation_id,
      COUNT(*) AS message_count,
      MIN(m.sent_at) AS first_message_at,
      COUNT(DISTINCT m.sender_id) AS distinct_senders,
      -- Initiator = sender of the earliest message. Tie-break on id so the
      -- From→To direction is deterministic when two messages share sent_at.
      (ARRAY_AGG(m.sender_id ORDER BY m.sent_at, m.id))[1] AS initiator_id
    FROM messages m
    JOIN base b ON b.id = m.conversation_id
    GROUP BY m.conversation_id
  ),
  -- First message from someone OTHER than the initiator = the first reply.
  first_reply AS (
    SELECT m.conversation_id, MIN(m.sent_at) AS first_reply_at
    FROM messages m
    JOIN msg_agg ma ON ma.conversation_id = m.conversation_id
    WHERE m.sender_id <> ma.initiator_id
    GROUP BY m.conversation_id
  ),
  enriched AS (
    SELECT
      b.id AS conversation_id,
      ma.initiator_id AS sender_id,
      CASE WHEN ma.initiator_id = b.p1 THEN b.p2 ELSE b.p1 END AS recipient_id,
      ma.first_message_at,
      b.last_message_at,
      ma.message_count,
      (ma.distinct_senders >= 2) AS replied,
      ROUND(EXTRACT(EPOCH FROM (fr.first_reply_at - ma.first_message_at)) / 60.0, 1)
        AS time_to_first_reply_minutes,
      b.origin,
      CASE
        WHEN ma.distinct_senders < 2 THEN 'unanswered'
        WHEN b.last_message_at >= NOW() - INTERVAL '14 days' THEN 'active'
        ELSE 'inactive'
      END AS status
    FROM base b
    JOIN msg_agg ma ON ma.conversation_id = b.id
    LEFT JOIN first_reply fr ON fr.conversation_id = b.id
  ),
  filtered AS (
    SELECT
      e.*,
      sp.full_name AS sender_name,
      sp.role::TEXT AS sender_role,
      rp.full_name AS recipient_name,
      rp.role::TEXT AS recipient_role
    FROM enriched e
    JOIN profiles sp ON sp.id = e.sender_id
    JOIN profiles rp ON rp.id = e.recipient_id
    WHERE (v_status IS NULL OR e.status = v_status)
      AND (v_origin IS NULL OR e.origin = v_origin)
      AND (v_role   IS NULL OR sp.role::TEXT = v_role OR rp.role::TEXT = v_role)
  )
  SELECT
    f.conversation_id,
    f.sender_id,
    f.sender_name,
    f.sender_role,
    f.recipient_id,
    f.recipient_name,
    f.recipient_role,
    f.first_message_at,
    f.last_message_at,
    f.message_count,
    f.replied,
    f.time_to_first_reply_minutes,
    f.status,
    f.origin,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.last_message_at DESC NULLS LAST, f.first_message_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_conversations(INT, INT, INT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_conversations(INT, INT, INT, JSONB) TO authenticated;
