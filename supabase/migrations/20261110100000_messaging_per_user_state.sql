-- Messaging: per-member conversation state and "delete for me" (founder 2026-11-10).
--
-- What members asked for, and the rulings:
--   * Mark a conversation as unread, as a reminder to come back to it.
--   * Delete a conversation. Like WhatsApp: the history is cleared for that
--     member only; if the other person writes again the conversation comes
--     back with only the new messages. The other person is never told.
--   * Delete a message for me (anyone, any message) besides the existing
--     author-only "delete for everyone" (delete_message, soft delete).
--
-- Nothing is ever hard-deleted (ruling 2026-09-23: reports and moderation keep
-- the record). Both features are per-member views over the same rows:
--   conversation_user_state(conversation_id, user_id, marked_unread_at, cleared_at)
--   message_user_hides(message_id, user_id, hidden_at)
-- Members read only their own rows; all writes go through the DEFINER RPCs below.
--
-- Old native clients (bundled JS) keep working unchanged:
--   * get_user_conversations keeps its exact return shape. A conversation marked
--     unread reports unread_count >= 1, so every client shows the unread dot.
--   * Cleared and hidden messages are filtered by the messages SELECT policy, so
--     an old build never shows a deleted history either.

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE public.conversation_user_state (
  conversation_id  uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marked_unread_at timestamptz,
  cleared_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_user_state_user_idx ON public.conversation_user_state (user_id)
  WHERE marked_unread_at IS NOT NULL;

CREATE TABLE public.message_user_hides (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

ALTER TABLE public.conversation_user_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_user_hides ENABLE ROW LEVEL SECURITY;

-- Read-only to members, own rows only; writes only through the RPCs.
REVOKE ALL ON TABLE public.conversation_user_state FROM anon, authenticated;
REVOKE ALL ON TABLE public.message_user_hides FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversation_user_state TO authenticated;
GRANT SELECT ON TABLE public.message_user_hides TO authenticated;
GRANT ALL ON TABLE public.conversation_user_state TO service_role;
GRANT ALL ON TABLE public.message_user_hides TO service_role;

CREATE POLICY "Members read their own conversation state"
  ON public.conversation_user_state FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Members read their own message hides"
  ON public.message_user_hides FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── Messages SELECT: hide what this member deleted ─────────────────────────
-- New rows always pass (server-stamped sent_at is after any cleared_at, and a
-- new row has no hide), so INSERT … RETURNING and realtime are unaffected.
DROP POLICY IF EXISTS "Users can view messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can view messages in their conversations v2"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    user_in_conversation(conversation_id, (SELECT auth.uid()))
    AND NOT EXISTS (
      SELECT 1 FROM public.message_user_hides h
      WHERE h.user_id = (SELECT auth.uid()) AND h.message_id = messages.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.conversation_user_state s
      WHERE s.conversation_id = messages.conversation_id
        AND s.user_id = (SELECT auth.uid())
        AND s.cleared_at IS NOT NULL
        AND messages.sent_at <= s.cleared_at
    )
  );

-- ── RPCs ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_conversation_member(p_conversation_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.participant_one_id = v_uid OR c.participant_two_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_conversation_member(uuid) FROM PUBLIC, anon, authenticated;

-- Mark (true) or clear (false) the member's own "unread" reminder.
CREATE OR REPLACE FUNCTION public.set_conversation_marked_unread(p_conversation_id uuid, p_unread boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := public._assert_conversation_member(p_conversation_id);
BEGIN
  IF p_unread THEN
    INSERT INTO public.conversation_user_state (conversation_id, user_id, marked_unread_at, updated_at)
    VALUES (p_conversation_id, v_uid, now(), now())
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET marked_unread_at = now(), updated_at = now();
  ELSE
    UPDATE public.conversation_user_state
       SET marked_unread_at = NULL, updated_at = now()
     WHERE conversation_id = p_conversation_id AND user_id = v_uid
       AND marked_unread_at IS NOT NULL;
  END IF;
END;
$$;

-- Delete a conversation for the member: clear the history up to now and hide
-- it until a new message arrives. Incoming messages still unread are marked
-- read so the inbox dot clears (the unread counters are keyed on read_at).
CREATE OR REPLACE FUNCTION public.delete_conversation_for_me(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public._assert_conversation_member(p_conversation_id);
  v_now timestamptz := now();
BEGIN
  INSERT INTO public.conversation_user_state (conversation_id, user_id, cleared_at, marked_unread_at, updated_at)
  VALUES (p_conversation_id, v_uid, v_now, NULL, v_now)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET cleared_at = v_now, marked_unread_at = NULL, updated_at = v_now;

  UPDATE public.messages
     SET read_at = v_now
   WHERE conversation_id = p_conversation_id
     AND sender_id <> v_uid
     AND read_at IS NULL
     AND sent_at <= v_now;
END;
$$;

-- Delete one message for the member only (any message in their conversation,
-- theirs or the other person's, including a "Message deleted" tombstone).
CREATE OR REPLACE FUNCTION public.hide_message_for_me(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv uuid;
  v_uid uuid;
BEGIN
  SELECT conversation_id INTO v_conv FROM public.messages WHERE id = p_message_id;
  IF v_conv IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_uid := public._assert_conversation_member(v_conv);

  INSERT INTO public.message_user_hides (message_id, user_id)
  VALUES (p_message_id, v_uid)
  ON CONFLICT (user_id, message_id) DO NOTHING;

  -- A hidden incoming message must not keep the conversation unread.
  UPDATE public.messages
     SET read_at = now()
   WHERE id = p_message_id AND sender_id <> v_uid AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.set_conversation_marked_unread(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_conversation_for_me(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hide_message_for_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_marked_unread(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_conversation_for_me(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hide_message_for_me(uuid) TO authenticated, service_role;

-- Reading a conversation also clears the member's "unread" reminder.
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

-- ── Inbox dot (tab bar / header) ────────────────────────────────────────────
-- unread_count stays "people with unread messages" from the materialised
-- counter, plus one per conversation the member marked unread, so the dot
-- lights up for a reminder too. Clients only test > 0.
CREATE OR REPLACE VIEW public.user_unread_counts_secure
WITH (security_invoker = true)
AS
SELECT
  (SELECT auth.uid()) AS user_id,
  (COALESCE(c.unread_count, 0)
    + (SELECT count(*) FROM public.conversation_user_state s
        WHERE s.user_id = (SELECT auth.uid()) AND s.marked_unread_at IS NOT NULL))::bigint AS unread_count,
  COALESCE(c.updated_at, now()) AS updated_at
FROM (SELECT 1) one
LEFT JOIN public.user_unread_counters c ON c.user_id = (SELECT auth.uid())
WHERE (SELECT auth.uid()) IS NOT NULL;

GRANT SELECT ON public.user_unread_counts_secure TO authenticated;

-- ── Conversation list ───────────────────────────────────────────────────────
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
      COALESCE(c.last_message_at, c.created_at) AS sort_timestamp,
      st.cleared_at,
      (st.marked_unread_at IS NOT NULL) AS marked_unread
    FROM public.conversations c
    LEFT JOIN public.conversation_user_state st
      ON st.conversation_id = c.id AND st.user_id = p_user_id
    WHERE (c.participant_one_id = p_user_id OR c.participant_two_id = p_user_id)
      -- DELETED FOR ME: hidden until a message arrives after the delete
      AND (st.cleared_at IS NULL OR COALESCE(c.last_message_at, c.created_at) > st.cleared_at)
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
  visible_messages AS (
    -- What this member can see: not deleted for everyone, not deleted for
    -- them, and not before they cleared the conversation.
    SELECT m.conversation_id, m.content, m.sent_at, m.sender_id, m.read_at
    FROM public.messages m
    INNER JOIN final_page fp ON fp.conv_id = m.conversation_id
    WHERE m.deleted_at IS NULL
      AND (fp.cleared_at IS NULL OR m.sent_at > fp.cleared_at)
      AND NOT EXISTS (
        SELECT 1 FROM public.message_user_hides h
        WHERE h.user_id = p_user_id AND h.message_id = m.id
      )
  ),
  last_messages AS (
    SELECT DISTINCT ON (vm.conversation_id)
      vm.conversation_id, vm.content, vm.sent_at, vm.sender_id
    FROM visible_messages vm
    ORDER BY vm.conversation_id, vm.sent_at DESC
  ),
  unread_counts AS (
    SELECT vm.conversation_id, COUNT(*) AS unread_count
    FROM visible_messages vm
    WHERE vm.sender_id <> p_user_id AND vm.read_at IS NULL
    GROUP BY vm.conversation_id
  )
  SELECT
    fp.conv_id, fp.other_user_id, p.full_name, p.username, p.avatar_url, p.role::TEXT,
    lm.content, lm.sent_at, lm.sender_id,
    -- A conversation the member marked unread reports at least 1, so every
    -- client (old native builds included) shows the unread dot.
    GREATEST(COALESCE(ur.unread_count, 0), CASE WHEN fp.marked_unread THEN 1 ELSE 0 END)::bigint,
    fp.created_at, fp.updated_at, fp.last_message_at,
    EXISTS (SELECT 1 FROM limited WHERE row_num > LEAST(GREATEST(p_limit, 1), 200)) AS has_more
  FROM final_page fp
  LEFT JOIN public.profiles p ON p.id = fp.other_user_id
  LEFT JOIN last_messages lm ON lm.conversation_id = fp.conv_id
  LEFT JOIN unread_counts ur ON ur.conversation_id = fp.conv_id
  ORDER BY fp.sort_timestamp DESC, fp.conv_id DESC;
END;
$function$;
