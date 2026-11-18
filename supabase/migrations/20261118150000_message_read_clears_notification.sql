-- Reading a conversation marks its "new message" notification read: the
-- condition from 20261118140000 never matched the chat screen (2026-11-18).
--
-- 20261118140000 marked the notification read only when the RPC was called
-- without p_before. The chat screen always passes p_before (the newest
-- message it showed), so on staging the notification stayed unread after the
-- conversation was opened. Found by the staging check right after applying
-- that migration; it has not reached production.
--
-- Now the notification is marked read whenever the call leaves nothing unread
-- from the other person in that conversation, with or without p_before.
--
-- Not breaking: same signature, grants and return value. No table, RLS or
-- grant changes.
--
-- Rollback: supabase/rollbacks/20261118150000_message_read_clears_notification.down.sql

CREATE OR REPLACE FUNCTION public.mark_conversation_messages_read(
  p_conversation_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile_id UUID := auth.uid();
  cutoff TIMESTAMPTZ := COALESCE(p_before, timezone('utc', now()));
  updated_rows INTEGER := 0;
BEGIN
  IF current_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.participant_one_id = current_profile_id OR c.participant_two_id = current_profile_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.messages
     SET read_at = timezone('utc', now())
   WHERE conversation_id = p_conversation_id
     AND sender_id <> current_profile_id
     AND read_at IS NULL
     AND (p_before IS NULL OR sent_at <= cutoff);

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  -- Reading the conversation is reading its "new message" notification: the
  -- bell stops showing it as new and the email digest stops counting it.
  -- The chat screen always sends p_before (the newest message it showed), so
  -- the test is what is left: nothing unread from the other person.
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.conversation_id = p_conversation_id
       AND m.sender_id <> current_profile_id
       AND m.read_at IS NULL
  ) THEN
    UPDATE public.profile_notifications
       SET read_at = timezone('utc', now())
     WHERE recipient_profile_id = current_profile_id
       AND kind = 'message_received'
       AND source_entity_id = p_conversation_id
       AND read_at IS NULL;
  END IF;

  UPDATE public.conversation_user_state
     SET marked_unread_at = NULL, updated_at = now()
   WHERE conversation_id = p_conversation_id
     AND user_id = current_profile_id
     AND marked_unread_at IS NOT NULL;

  RETURN updated_rows;
END;
$$;
