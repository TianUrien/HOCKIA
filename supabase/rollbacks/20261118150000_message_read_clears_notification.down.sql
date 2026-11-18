-- Rollback for 20261118150000_message_read_clears_notification.sql: the
-- function as 20261118140000 left it.

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
  -- Only when the whole conversation was read (no p_before cut-off).
  IF p_before IS NULL THEN
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
