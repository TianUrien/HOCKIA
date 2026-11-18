-- Rollback for 20261118140000_message_digest_reemail.sql: the two functions as
-- they were (handle_message_notifications from 20260928110000,
-- mark_conversation_messages_read from 20261110100000). Notifications already
-- marked read or made emailable again stay as they are.

CREATE OR REPLACE FUNCTION public.handle_message_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recipient uuid;
  other_exists boolean;
  existing_notification record;
  existing_count int;
  sender_ids jsonb;
BEGIN
  -- Recruiting cards notify through recruiting_update (see 20260928120000).
  IF public.is_recruiting_card(NEW.metadata) THEN
    RETURN NEW;
  END IF;

  -- Get the recipient of this message
  SELECT CASE
    WHEN c.participant_one_id = NEW.sender_id THEN c.participant_two_id
    ELSE c.participant_one_id
  END
  INTO recipient
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF recipient IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check for existing unread message notification for this conversation
  SELECT id, metadata
  INTO existing_notification
  FROM public.profile_notifications
  WHERE recipient_profile_id = recipient
    AND kind = 'message_received'
    AND source_entity_id = NEW.conversation_id  -- Use conversation_id as source
    AND read_at IS NULL
    AND cleared_at IS NULL
  LIMIT 1;

  IF existing_notification IS NOT NULL THEN
    -- Aggregate: update existing notification with new message info
    existing_count := coalesce((existing_notification.metadata->>'message_count')::int, 1);
    sender_ids := coalesce(existing_notification.metadata->'sender_ids', '[]'::jsonb);

    -- Add sender to list if not already present
    IF NOT sender_ids ? NEW.sender_id::text THEN
      sender_ids := sender_ids || to_jsonb(NEW.sender_id::text);
    END IF;

    UPDATE public.profile_notifications
    SET
      metadata = jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'last_message_id', NEW.id,
        'message_count', existing_count + 1,
        'sender_ids', sender_ids
      ),
      updated_at = timezone('utc', now()),
      -- Keep created_at unchanged to preserve original notification time
      actor_profile_id = NEW.sender_id  -- Update to latest sender
    WHERE id = existing_notification.id;
  ELSE
    -- Create new notification with conversation_id as source_entity_id
    PERFORM public.enqueue_notification(
      recipient,
      NEW.sender_id,
      'message_received',
      NEW.conversation_id,  -- Changed from NEW.id to NEW.conversation_id
      jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'last_message_id', NEW.id,
        'message_count', 1,
        'sender_ids', jsonb_build_array(NEW.sender_id::text)
      ),
      NULL
    );
  END IF;

  -- Check if this is the first message in the conversation
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.conversation_id = NEW.conversation_id AND m.id <> NEW.id
  ) INTO other_exists;

  IF NOT other_exists THEN
    PERFORM public.enqueue_notification(
      recipient,
      NEW.sender_id,
      'conversation_started',
      NEW.conversation_id,
      jsonb_build_object(
        'conversation_id', NEW.conversation_id
      ),
      NULL
    );
  END IF;

  RETURN NEW;
END;
$function$;

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

  UPDATE public.conversation_user_state
     SET marked_unread_at = NULL, updated_at = now()
   WHERE conversation_id = p_conversation_id
     AND user_id = current_profile_id
     AND marked_unread_at IS NOT NULL;

  RETURN updated_rows;
END;
$$;
