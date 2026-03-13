-- Messaging Health Analytics RPC
-- Response times, conversation depth, unanswered conversations

CREATE OR REPLACE FUNCTION admin_get_messaging_health(
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
  -- New conversations in period
  new_convos AS (
    SELECT c.id, c.participant_one_id, c.participant_two_id, c.created_at
    FROM conversations c
    WHERE c.created_at >= v_since
      AND c.participant_one_id NOT IN (SELECT id FROM test_ids)
      AND c.participant_two_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Messages in period with conversation context
  period_messages AS (
    SELECT
      m.conversation_id,
      m.sender_id,
      m.sent_at,
      m.read_at,
      LAG(m.sender_id) OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at) AS prev_sender_id,
      LAG(m.sent_at) OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at) AS prev_sent_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.sent_at >= v_since
      AND m.sender_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Response times (time between messages from different senders in same conversation)
  response_times AS (
    SELECT
      EXTRACT(EPOCH FROM (sent_at - prev_sent_at)) / 60.0 AS response_minutes
    FROM period_messages
    WHERE prev_sender_id IS NOT NULL
      AND prev_sender_id != sender_id
      AND prev_sent_at IS NOT NULL
  ),
  response_stats AS (
    SELECT
      ROUND(AVG(response_minutes)::numeric, 1) AS avg_response_minutes,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_minutes)::numeric, 1) AS median_response_minutes,
      COUNT(*) AS total_responses
    FROM response_times
    WHERE response_minutes < 10080  -- Exclude responses > 7 days as outliers
  ),
  -- Conversation depth (messages per conversation)
  convo_depth AS (
    SELECT
      m.conversation_id,
      COUNT(*) AS message_count,
      COUNT(DISTINCT m.sender_id) AS unique_senders
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.participant_one_id NOT IN (SELECT id FROM test_ids)
      AND c.participant_two_id NOT IN (SELECT id FROM test_ids)
    GROUP BY m.conversation_id
  ),
  depth_distribution AS (
    SELECT
      COUNT(*) FILTER (WHERE message_count = 1) AS single_message,
      COUNT(*) FILTER (WHERE message_count BETWEEN 2 AND 5) AS short_2_5,
      COUNT(*) FILTER (WHERE message_count BETWEEN 6 AND 10) AS medium_6_10,
      COUNT(*) FILTER (WHERE message_count BETWEEN 11 AND 25) AS long_11_25,
      COUNT(*) FILTER (WHERE message_count > 25) AS very_long_25_plus,
      ROUND(AVG(message_count)::numeric, 1) AS avg_depth
    FROM convo_depth
  ),
  -- One-sided conversations (only one sender, 1+ messages, last message > 48h ago)
  unanswered AS (
    SELECT COUNT(*) AS unanswered_count
    FROM convo_depth cd
    JOIN conversations c ON c.id = cd.conversation_id
    WHERE cd.unique_senders = 1
      AND cd.message_count >= 1
      AND c.last_message_at < NOW() - INTERVAL '48 hours'
      AND c.last_message_at >= v_since
  ),
  -- Top messengers
  top_messengers AS (
    SELECT
      m.sender_id,
      p.full_name AS display_name,
      p.role,
      COUNT(*) AS message_count,
      COUNT(DISTINCT m.conversation_id) AS conversation_count
    FROM messages m
    JOIN profiles p ON p.id = m.sender_id
    WHERE m.sent_at >= v_since
      AND m.sender_id NOT IN (SELECT id FROM test_ids)
    GROUP BY m.sender_id, p.full_name, p.role
    ORDER BY message_count DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'new_conversations', (SELECT COUNT(*) FROM new_convos),
      'total_messages', (SELECT COUNT(*) FROM period_messages),
      'unique_senders', (SELECT COUNT(DISTINCT sender_id) FROM period_messages),
      'unanswered_conversations', (SELECT unanswered_count FROM unanswered)
    ),
    'response_time', (SELECT row_to_json(rs)::jsonb FROM response_stats rs),
    'depth_distribution', (SELECT row_to_json(dd)::jsonb FROM depth_distribution dd),
    'top_messengers', COALESCE((SELECT jsonb_agg(row_to_json(tm)::jsonb) FROM top_messengers tm), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_messaging_health TO authenticated;
