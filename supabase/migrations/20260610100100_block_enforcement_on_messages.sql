-- ============================================================================
-- Re-enforce user blocking on the DM send path (audit High / launch-blocker)
-- ============================================================================
-- Problem: 202603251100_revert_all_rls_block_checks.sql removed the block check
-- from the messages + conversations INSERT policies (RLS subqueries hit error
-- 42P10 with generated-column unique indexes). Its note claimed blocks stay
-- "active via RPCs", but the SEND path is a DIRECT table insert
-- (client/src/hooks/useChat.ts -> supabase.from('messages').insert(...)); there
-- is no send_message RPC. So a blocked user could POST /rest/v1/messages
-- directly and the message-notify trigger would fire for the victim.
--
-- Fix: enforce the block in BEFORE INSERT triggers (the same pattern
-- handle_friendship_state uses — triggers avoid the 42P10 issue). SECURITY
-- DEFINER so the check can read user_blocks regardless of the caller's RLS.

-- ── messages ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_message_not_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p_one UUID;
  p_two UUID;
BEGIN
  SELECT participant_one_id, participant_two_id
    INTO p_one, p_two
    FROM public.conversations
    WHERE id = NEW.conversation_id;

  -- Conversation missing / not yet readable: let FK + the existing
  -- user_in_conversation INSERT policy handle rejection.
  IF p_one IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = p_one AND blocked_id = p_two)
       OR (blocker_id = p_two AND blocked_id = p_one)
  ) THEN
    RAISE EXCEPTION 'Cannot message a user you have blocked or who has blocked you.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_message_not_blocked() IS
  'Blocks DM inserts between users where a user_blocks row exists (either direction). Replaces the RLS block check reverted in 202603251100. See migration 20260610100100.';

DROP TRIGGER IF EXISTS messages_enforce_not_blocked ON public.messages;
CREATE TRIGGER messages_enforce_not_blocked
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_not_blocked();

-- ── conversations ─────────────────────────────────────────────────────────
-- Also stop a blocked pair from creating a NEW conversation (the message
-- trigger covers existing conversations; this covers the first message).
CREATE OR REPLACE FUNCTION public.enforce_conversation_not_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = NEW.participant_one_id AND blocked_id = NEW.participant_two_id)
       OR (blocker_id = NEW.participant_two_id AND blocked_id = NEW.participant_one_id)
  ) THEN
    RAISE EXCEPTION 'Cannot start a conversation with a user you have blocked or who has blocked you.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_conversation_not_blocked() IS
  'Blocks conversation creation between a blocked pair (either direction). See migration 20260610100100.';

DROP TRIGGER IF EXISTS conversations_enforce_not_blocked ON public.conversations;
CREATE TRIGGER conversations_enforce_not_blocked
  BEFORE INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_conversation_not_blocked();
