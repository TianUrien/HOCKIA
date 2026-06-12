-- ============================================================================
-- Message edit + soft-delete
-- ============================================================================
-- Adds user-facing "edit message" and "delete message" to direct messages.
--
-- Design (see also client/src/features/chat-v2):
--   * SOFT delete: set content='' + deleted_at; the row stays so pagination
--     cursors, read receipts and conversations.last_message_at stay intact, and
--     the change rides the existing realtime UPDATE handler (a hard DELETE would
--     need a new client subscription and would fire the unread-cleanup trigger).
--     The original text IS removed (privacy) — the UI renders a "Message
--     deleted" tombstone from deleted_at, not from the (now empty) content.
--   * Both mutations go through SECURITY DEFINER RPCs that check
--     auth.uid() = sender_id, mirroring mark_conversation_messages_read and
--     deliberately avoiding a broad UPDATE grant/policy on the table.
--
-- The existing enforce_message_update_immutability trigger hard-blocks ANY
-- content change, so it is rewritten here to permit content changes ONLY as
-- part of an edit (edited_at advances) or a soft-delete (deleted_at is set),
-- and ONLY by the author. The author check matters: the "Users can mark
-- messages as read v2" RLS policy lets the *recipient* UPDATE the row, so
-- without it a recipient could forge an edit on a message they received.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.messages.edited_at  IS 'Set when the author edits the message; drives the "edited" label.';
COMMENT ON COLUMN public.messages.deleted_at IS 'Set when the author soft-deletes; content is blanked and the UI shows a "Message deleted" tombstone.';

-- ----------------------------------------------------------------------------
-- 2. Relax the length CHECK so a soft-deleted row may hold empty content
-- ----------------------------------------------------------------------------
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_length_enforced;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_length_enforced
  CHECK (
    char_length(content) <= 1000
    AND (deleted_at IS NOT NULL OR char_length(content) > 0)
  );

-- ----------------------------------------------------------------------------
-- 3. Make the immutability trigger edit/delete-aware (and author-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_message_update_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid             uuid    := auth.uid();
  v_content_changed boolean := NEW.content    IS DISTINCT FROM OLD.content;
  v_edited_changed  boolean := NEW.edited_at  IS DISTINCT FROM OLD.edited_at;
  v_deleted_changed boolean := NEW.deleted_at IS DISTINCT FROM OLD.deleted_at;
BEGIN
  -- Identity / threading columns are always immutable.
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Message sender is immutable';
  END IF;
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'Message conversation is immutable';
  END IF;
  IF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    RAISE EXCEPTION 'Message timestamp is immutable';
  END IF;
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'Message idempotency key is immutable';
  END IF;

  -- Fast path: pure read-receipt update (only read_at changed) — unchanged
  -- behaviour, no further checks.
  IF NOT v_content_changed AND NOT v_edited_changed AND NOT v_deleted_changed THEN
    RETURN NEW;
  END IF;

  -- Any change to content / edited_at / deleted_at is an edit or a delete,
  -- which only the author may perform. Defence in depth behind the RPCs; also
  -- blocks the recipient (who can UPDATE via the "mark as read" policy) from
  -- forging one. A NULL uid is a trusted server/service-role context.
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Only the author can edit or delete a message';
  END IF;

  -- A deleted message is a frozen tombstone: no un-delete, no further edits.
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted messages cannot be modified';
  END IF;

  -- Content may change only as part of an edit (edited_at advances) or a
  -- soft-delete (deleted_at gets set this update). A bare content change with
  -- neither marker is still rejected, preserving the original guarantee.
  IF v_content_changed
     AND NOT v_edited_changed
     AND NOT (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Message content is immutable';
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. edit_message — author edits their own, non-deleted, text message
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_message(
  p_message_id uuid,
  p_content    text
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_trimmed text := btrim(p_content);
  v_row     public.messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF char_length(v_trimmed) = 0 THEN
    RAISE EXCEPTION 'Message cannot be empty' USING errcode = '23514';
  END IF;
  IF char_length(v_trimmed) > 1000 THEN
    RAISE EXCEPTION 'Message is too long (max 1000 characters)' USING errcode = '23514';
  END IF;

  UPDATE public.messages
     SET content   = v_trimmed,
         edited_at = timezone('utc', now())
   WHERE id = p_message_id
     AND sender_id = v_uid
     AND deleted_at IS NULL
     -- shared-post cards are not free text — they are not editable
     AND (metadata IS NULL OR metadata->>'type' IS DISTINCT FROM 'shared_post')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or not editable' USING errcode = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. delete_message — author soft-deletes their own message
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_message(
  p_message_id uuid
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;

  UPDATE public.messages
     SET content    = '',
         metadata   = NULL,
         deleted_at = timezone('utc', now())
   WHERE id = p_message_id
     AND sender_id = v_uid
     AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or already deleted' USING errcode = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Grants — authenticated only; never anon / public
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.edit_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_message(uuid)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_message(uuid)     TO authenticated;

COMMIT;
