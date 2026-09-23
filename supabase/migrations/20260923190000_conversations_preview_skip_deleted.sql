-- Inbox rows (Figma Inbox — Messages, walkthrough finding #3):
--   1. The preview shows the last VISIBLE message. delete_message soft-deletes
--      (content = '', deleted_at set), and get_user_conversations picked that
--      row as the "last message" — an empty preview that the client rendered
--      as "Say hello" even though the conversation had messages. Skip deleted
--      rows so the one before shows; "Say hello" is only for no messages at all.
--   (No DELETE policy: messages are soft-deleted on purpose — founder ruling
--   2026-09-23 — so reports and moderation keep the record. Test cleanup runs
--   with the service role, never through a client permission.)

CREATE OR REPLACE FUNCTION public.get_user_conversations(p_user_id uuid, p_limit integer DEFAULT 50, p_cursor_last_message_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(conversation_id uuid, other_participant_id uuid, other_participant_name text, other_participant_username text, other_participant_avatar text, other_participant_role text, last_message_content text, last_message_sent_at timestamp with time zone, last_message_sender_id uuid, unread_count bigint, conversation_created_at timestamp with time zone, conversation_updated_at timestamp with time zone, conversation_last_message_at timestamp with time zone, has_more boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_requesting_user UUID := auth.uid();
BEGIN
  IF v_requesting_user IS NULL THEN
    RAISE EXCEPTION 'get_user_conversations requires authentication' USING ERRCODE = '42501';
  END IF;
  IF v_requesting_user <> p_user_id THEN
    RAISE EXCEPTION 'Cannot fetch conversations for another user' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH user_conversations AS (
    SELECT
      c.id AS conv_id,
      CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END AS other_user_id,
      c.created_at,
      c.updated_at,
      c.last_message_at,
      COALESCE(c.last_message_at, c.created_at) AS sort_timestamp
    FROM public.conversations c
    WHERE (c.participant_one_id = p_user_id OR c.participant_two_id = p_user_id)
      -- BLOCK FILTER: hide conversations with blocked users
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
        WHERE (ub.blocker_id = p_user_id AND ub.blocked_id = CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END)
           OR (ub.blocker_id = CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END AND ub.blocked_id = p_user_id)
      )
      -- HIDDEN FILTER: hide conversations with banned / frozen-minor profiles
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles hp
        WHERE hp.id = CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END
          AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at)
      )
  ),
  paginated AS (
    SELECT *
    FROM user_conversations uc
    WHERE (p_cursor_last_message_at IS NULL AND p_cursor_conversation_id IS NULL)
       OR (uc.sort_timestamp < p_cursor_last_message_at)
       OR (uc.sort_timestamp = p_cursor_last_message_at AND (p_cursor_conversation_id IS NULL OR uc.conv_id < p_cursor_conversation_id))
    ORDER BY uc.sort_timestamp DESC, uc.conv_id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 200) + 1
  ),
  limited AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY sort_timestamp DESC, conv_id DESC) AS row_num FROM paginated
  ),
  final_page AS (
    SELECT * FROM limited WHERE row_num <= LEAST(GREATEST(p_limit, 1), 200)
  ),
  last_messages AS (
    -- The last VISIBLE message: a soft-deleted row (delete_message) must not
    -- blank the preview; the one before it shows instead.
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.content, m.sent_at, m.sender_id
    FROM public.messages m
    INNER JOIN final_page fp ON fp.conv_id = m.conversation_id
    WHERE m.deleted_at IS NULL
    ORDER BY m.conversation_id, m.sent_at DESC
  ),
  unread_counts AS (
    SELECT m.conversation_id, COUNT(*) AS unread_count
    FROM public.messages m
    INNER JOIN final_page fp ON fp.conv_id = m.conversation_id
    WHERE m.sender_id <> p_user_id AND m.read_at IS NULL
    GROUP BY m.conversation_id
  )
  SELECT
    fp.conv_id, fp.other_user_id, p.full_name, p.username, p.avatar_url, p.role::TEXT,
    lm.content, lm.sent_at, lm.sender_id, COALESCE(ur.unread_count, 0),
    fp.created_at, fp.updated_at, fp.last_message_at,
    EXISTS (SELECT 1 FROM limited WHERE row_num > LEAST(GREATEST(p_limit, 1), 200)) AS has_more
  FROM final_page fp
  LEFT JOIN public.profiles p ON p.id = fp.other_user_id
  LEFT JOIN last_messages lm ON lm.conversation_id = fp.conv_id
  LEFT JOIN unread_counts ur ON ur.conversation_id = fp.conv_id
  ORDER BY fp.sort_timestamp DESC, fp.conv_id DESC;
END;
$function$;

