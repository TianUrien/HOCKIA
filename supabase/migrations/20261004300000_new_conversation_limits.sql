-- New-conversation limits, admin signals and the removed-account notice.
-- Rollback: supabase/rollbacks/20261004300000_new_conversation_limits.down.sql
-- Probes:   supabase/tests/security/new_conversation_limits_acl.probe.sql (read-only)
--           supabase/tests/security/new_conversation_limits.probe.sql (staging, rolled back)
--
-- Founder spec 2026-09-26:
--   1. A member may start a limited number of NEW conversations per rolling 24 hours:
--        first 7 days of the account (profiles.created_at)      5
--        afterwards, clubs and coaches who recruit              30
--        afterwards, everyone else                              15
--      Replies and messages in existing conversations are not counted. Test accounts
--      and admins are exempt. Conversations opened by the server (invites, offers and
--      the other recruiting functions) are not counted; invites keep their own cap.
--   2. Two admin-only signals, nothing is blocked automatically:
--        daily_limit              the member used the whole daily allowance
--        repeated_first_message   the same or a near-identical first message went to
--                                 5 or more different people within 7 days
--   3. An admin can mark an account as removed and send one safety notice to every
--      member it had a conversation with; the chat shows a neutral notice.
--
-- How a "new conversation" is recognised
--   The client creates the conversations row itself (RLS policy "Users can create
--   conversations") and then inserts the first message. The server recruiting
--   functions create theirs inside SECURITY DEFINER functions. The two new triggers
--   carry WHEN (current_user = 'authenticated'): they fire for a statement run by a
--   signed-in client and never for one run inside a SECURITY DEFINER function (the
--   statement runs as the function owner there), by the service role or by the
--   database owner. No existing function, trigger or policy is changed.
--
--   The limit trigger runs AFTER INSERT on conversations, so a refusal removes the
--   row it refused (nothing empty is left behind) and a duplicate pair is still
--   answered by the unique index first. Every allowed start is written to
--   new_conversation_log, which is independent of the conversation row: deleting a
--   conversation does not give the allowance back. The allowance counts DIFFERENT
--   people, so starting again with the same person inside 24 hours is not a second use.
--
-- A refusal rolls its own statement back, so the trigger cannot record it. The
-- daily_limit signal is therefore written when the allowance is used up, and
-- log_new_conversation_refusal() lets an up-to-date client add to refusal_count.

-- ═══ 1 · Tables (no client access) ═════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.new_conversation_log (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                 uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  other_user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id         uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  first_message_at        timestamptz,
  first_message_hash      text,
  first_message_loose_key text
);

COMMENT ON TABLE public.new_conversation_log IS
  'One row per conversation a member started from a client. Kept when the conversation is deleted. Holds hashes of the first message, never its text.';

CREATE INDEX IF NOT EXISTS new_conversation_log_user_created_idx
  ON public.new_conversation_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS new_conversation_log_user_conversation_idx
  ON public.new_conversation_log (user_id, conversation_id);
CREATE INDEX IF NOT EXISTS new_conversation_log_other_user_idx
  ON public.new_conversation_log (other_user_id);

ALTER TABLE public.new_conversation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.new_conversation_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.new_conversation_log TO service_role;

CREATE TABLE IF NOT EXISTS public.spam_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('daily_limit', 'repeated_first_message')),
  -- daily_limit: the UTC day (YYYY-MM-DD). repeated_first_message: the loose key.
  signal_key      text NOT NULL,
  people_count    integer NOT NULL DEFAULT 0,
  identical_count integer,
  refusal_count   integer NOT NULL DEFAULT 0,
  sample_text     text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spam_signals_user_kind_key_unique UNIQUE (user_id, kind, signal_key)
);

COMMENT ON TABLE public.spam_signals IS
  'Admin-only signals. One row per member per day (daily_limit) or per repeated first message. Counts and one sample text, never per-recipient content.';

CREATE INDEX IF NOT EXISTS spam_signals_last_seen_idx
  ON public.spam_signals (last_seen_at DESC);

ALTER TABLE public.spam_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spam_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.spam_signals TO service_role;

CREATE TABLE IF NOT EXISTS public.removed_account_notices (
  profile_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_sent_at   timestamptz,
  notified_count integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.removed_account_notices IS
  'Accounts an admin marked as removed for spam. Written only by admin_send_removed_account_notice.';

ALTER TABLE public.removed_account_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.removed_account_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.removed_account_notices TO service_role;

CREATE TABLE IF NOT EXISTS public.removed_account_notice_recipients (
  profile_id      uuid NOT NULL REFERENCES public.removed_account_notices(profile_id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, recipient_id)
);

COMMENT ON TABLE public.removed_account_notice_recipients IS
  'Who already received the safety notice about a removed account: the reason a second call never notifies anyone twice.';

CREATE INDEX IF NOT EXISTS removed_account_notice_recipients_recipient_idx
  ON public.removed_account_notice_recipients (recipient_id);

ALTER TABLE public.removed_account_notice_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.removed_account_notice_recipients FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.removed_account_notice_recipients TO service_role;


-- ═══ 2 · The daily allowance ═══════════════════════════════════════════════════

-- NULL = exempt (test account) or no profile.
CREATE OR REPLACE FUNCTION public._new_conversation_daily_limit(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN coalesce(p.is_test_account, false) THEN NULL
           WHEN p.created_at > now() - interval '7 days' THEN 5
           WHEN p.role = 'club' OR (p.role = 'coach' AND coalesce(p.coach_recruits_for_team, false)) THEN 30
           ELSE 15
         END
    FROM public.profiles p
   WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public._new_conversation_daily_limit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._new_conversation_daily_limit(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._enforce_new_conversation_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_other uuid;
  v_limit integer;
  v_used  integer;
  v_known boolean;
  v_now   timestamptz := now();
BEGIN
  IF v_uid IS NULL
     OR v_uid NOT IN (NEW.participant_one_id, NEW.participant_two_id)
     OR NEW.participant_one_id = NEW.participant_two_id THEN
    RETURN NULL;
  END IF;
  IF public.is_platform_admin() THEN
    RETURN NULL;
  END IF;

  v_limit := public._new_conversation_daily_limit(v_uid);
  IF v_limit IS NULL THEN
    RETURN NULL;
  END IF;

  v_other := CASE WHEN NEW.participant_one_id = v_uid THEN NEW.participant_two_id ELSE NEW.participant_one_id END;

  PERFORM pg_advisory_xact_lock(hashtext('new_conversation:' || v_uid::text));

  SELECT count(DISTINCT l.other_user_id), coalesce(bool_or(l.other_user_id = v_other), false)
    INTO v_used, v_known
    FROM public.new_conversation_log l
   WHERE l.user_id = v_uid
     AND l.created_at > v_now - interval '24 hours';

  IF NOT v_known AND v_used >= v_limit THEN
    RAISE EXCEPTION 'You''ve started a lot of new conversations today. You can start more tomorrow.'
      USING DETAIL = 'new_conversation_limit', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.new_conversation_log (user_id, other_user_id, conversation_id, created_at)
  VALUES (v_uid, v_other, NEW.id, v_now);

  IF NOT v_known AND v_used + 1 >= v_limit THEN
    INSERT INTO public.spam_signals AS s (user_id, kind, signal_key, people_count, first_seen_at, last_seen_at)
    VALUES (v_uid, 'daily_limit', to_char(v_now AT TIME ZONE 'utc', 'YYYY-MM-DD'), v_used + 1, v_now, v_now)
    ON CONFLICT ON CONSTRAINT spam_signals_user_kind_key_unique DO UPDATE
      SET people_count = greatest(s.people_count, excluded.people_count),
          last_seen_at = excluded.last_seen_at;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._enforce_new_conversation_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enforce_new_conversation_limit() TO service_role;

DROP TRIGGER IF EXISTS conversations_new_conversation_limit ON public.conversations;
CREATE TRIGGER conversations_new_conversation_limit
  AFTER INSERT ON public.conversations
  FOR EACH ROW
  WHEN (current_user = 'authenticated')
  EXECUTE FUNCTION public._enforce_new_conversation_limit();

-- An up-to-date client calls this after a refusal. It only counts when the caller
-- really is at the allowance, and only ever touches the caller's own row.
CREATE OR REPLACE FUNCTION public.log_new_conversation_refusal()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit integer;
  v_used  integer;
  v_now   timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  v_limit := public._new_conversation_daily_limit(v_uid);
  IF v_limit IS NULL THEN
    RETURN;
  END IF;

  SELECT count(DISTINCT l.other_user_id) INTO v_used
    FROM public.new_conversation_log l
   WHERE l.user_id = v_uid
     AND l.created_at > v_now - interval '24 hours';
  IF v_used < v_limit THEN
    RETURN;
  END IF;

  INSERT INTO public.spam_signals AS s (user_id, kind, signal_key, people_count, refusal_count, first_seen_at, last_seen_at)
  VALUES (v_uid, 'daily_limit', to_char(v_now AT TIME ZONE 'utc', 'YYYY-MM-DD'), v_used, 1, v_now, v_now)
  ON CONFLICT ON CONSTRAINT spam_signals_user_kind_key_unique DO UPDATE
    SET refusal_count = least(s.refusal_count + 1, 100000),
        people_count  = greatest(s.people_count, excluded.people_count),
        last_seen_at  = excluded.last_seen_at;
END;
$$;

REVOKE ALL ON FUNCTION public.log_new_conversation_refusal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_new_conversation_refusal() TO authenticated, service_role;


-- ═══ 3 · Repeated first message ════════════════════════════════════════════════

-- Lower case, letters only, single spaces. Digits, punctuation and symbols go, so
-- a changed number, name tag or emoji does not make the text "different".
CREATE OR REPLACE FUNCTION public._normalise_first_message(p_content text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(lower(coalesce(p_content, '')), '[^[:alpha:][:space:]]+', '', 'g'),
           '[[:space:]]+', ' ', 'g'));
$$;

REVOKE ALL ON FUNCTION public._normalise_first_message(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._normalise_first_message(text) TO service_role;

-- The first message the starter sends in a conversation they started from a client.
-- Never fails a send: any error inside is swallowed.
CREATE OR REPLACE FUNCTION public._track_first_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_min_people constant integer := 5;
  c_min_length constant integer := 20;
  v_log_id    bigint;
  v_norm      text;
  v_hash      text;
  v_loose     text;
  v_people    integer;
  v_identical integer;
  v_now       timestamptz := now();
BEGIN
  SELECT l.id INTO v_log_id
    FROM public.new_conversation_log l
   WHERE l.user_id = NEW.sender_id
     AND l.conversation_id = NEW.conversation_id
     AND l.first_message_at IS NULL
   ORDER BY l.id DESC
   LIMIT 1;
  IF v_log_id IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    -- Card messages (a shared post) carry metadata and a fixed text: not compared.
    IF NEW.metadata IS NOT NULL AND jsonb_typeof(NEW.metadata) <> 'null' THEN
      UPDATE public.new_conversation_log SET first_message_at = v_now WHERE id = v_log_id;
      RETURN NULL;
    END IF;

    v_norm := public._normalise_first_message(NEW.content);
    -- Short greetings ("hi", "hello there") are the same for everyone: not compared.
    IF length(v_norm) < c_min_length THEN
      UPDATE public.new_conversation_log SET first_message_at = v_now WHERE id = v_log_id;
      RETURN NULL;
    END IF;

    v_hash  := md5(v_norm);
    v_loose := md5(left(v_norm, 80));

    UPDATE public.new_conversation_log
       SET first_message_at = v_now, first_message_hash = v_hash, first_message_loose_key = v_loose
     WHERE id = v_log_id;

    SELECT count(DISTINCT l.other_user_id),
           count(DISTINCT l.other_user_id) FILTER (WHERE l.first_message_hash = v_hash)
      INTO v_people, v_identical
      FROM public.new_conversation_log l
     WHERE l.user_id = NEW.sender_id
       AND l.first_message_loose_key = v_loose
       AND l.first_message_at > v_now - interval '7 days';

    IF v_people >= c_min_people THEN
      INSERT INTO public.spam_signals AS s (user_id, kind, signal_key, people_count, identical_count, sample_text, first_seen_at, last_seen_at)
      VALUES (NEW.sender_id, 'repeated_first_message', v_loose, v_people, v_identical, left(btrim(NEW.content), 300), v_now, v_now)
      ON CONFLICT ON CONSTRAINT spam_signals_user_kind_key_unique DO UPDATE
        SET people_count    = greatest(s.people_count, excluded.people_count),
            identical_count = greatest(coalesce(s.identical_count, 0), excluded.identical_count),
            last_seen_at    = excluded.last_seen_at;
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._track_first_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._track_first_message() TO service_role;

DROP TRIGGER IF EXISTS messages_track_first_message ON public.messages;
CREATE TRIGGER messages_track_first_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  WHEN (current_user = 'authenticated')
  EXECUTE FUNCTION public._track_first_message();


-- ═══ 4 · Admin: the signals list ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_get_spam_signals(
  p_days integer DEFAULT 30, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_total integer;
  v_rows  jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.spam_signals s
   WHERE s.last_seen_at >= v_since;

  SELECT jsonb_agg(to_jsonb(sub) ORDER BY sub.last_seen_at DESC, sub.id) INTO v_rows
    FROM (
      SELECT s.id, s.kind, s.people_count, s.identical_count, s.refusal_count,
             CASE WHEN s.kind = 'repeated_first_message' THEN s.sample_text END AS sample_text,
             s.first_seen_at, s.last_seen_at,
             p.id AS profile_id, p.full_name, p.role,
             p.created_at AS account_created_at,
             coalesce(p.is_blocked, false) AS is_blocked, p.blocked_at,
             n.created_at AS removed_at, n.last_sent_at AS notice_sent_at, n.notified_count AS notice_count
        FROM public.spam_signals s
        JOIN public.profiles p ON p.id = s.user_id
        LEFT JOIN public.removed_account_notices n ON n.profile_id = s.user_id
       WHERE s.last_seen_at >= v_since
       ORDER BY s.last_seen_at DESC, s.id
       LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
      OFFSET greatest(coalesce(p_offset, 0), 0)
    ) sub;

  RETURN jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_spam_signals(integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_spam_signals(integer, integer, integer) TO authenticated, service_role;


-- ═══ 5 · Removed-account notice ════════════════════════════════════════════════

-- Marks the account as removed and sends one in-app notice to every member it has a
-- conversation with (at least one message in it). Safe to call again: only members
-- who were not notified before get one. Returns how many were notified by THIS call.
-- An admin action run by hand: nothing in this migration calls it.
CREATE OR REPLACE FUNCTION public.admin_send_removed_account_notice(p_removed_profile_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_title constant text := 'A message about your safety';
  c_text  constant text := 'An account that messaged you has been removed for spam. Hockia will never ask you for money. Don''t send money, crypto or personal details to people you haven''t met, and be careful if someone asks to move to WhatsApp or another app. If something feels off, tap Report.';
  v_admin  uuid := auth.uid();
  v_hidden boolean;
  v_url    text;
  v_nid    uuid;
  v_n      integer := 0;
  r        record;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_removed_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at) INTO v_hidden
    FROM public.profiles p
   WHERE p.id = p_removed_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('removed_account_notice:' || p_removed_profile_id::text));

  INSERT INTO public.removed_account_notices (profile_id, created_by)
  VALUES (p_removed_profile_id, v_admin)
  ON CONFLICT (profile_id) DO NOTHING;

  FOR r IN
    SELECT DISTINCT ON (x.recipient_id) x.recipient_id, x.conversation_id
      FROM (
        SELECT CASE WHEN c.participant_one_id = p_removed_profile_id THEN c.participant_two_id ELSE c.participant_one_id END AS recipient_id,
               c.id AS conversation_id
          FROM public.conversations c
         WHERE (c.participant_one_id = p_removed_profile_id OR c.participant_two_id = p_removed_profile_id)
           AND EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id)
      ) x
      JOIN public.profiles rp ON rp.id = x.recipient_id
     WHERE x.recipient_id <> p_removed_profile_id
       AND NOT public.profile_is_hidden(rp.is_blocked, rp.frozen_minor_at)
       AND NOT EXISTS (
             SELECT 1 FROM public.removed_account_notice_recipients d
              WHERE d.profile_id = p_removed_profile_id AND d.recipient_id = x.recipient_id)
     ORDER BY x.recipient_id, x.conversation_id
  LOOP
    INSERT INTO public.removed_account_notice_recipients (profile_id, recipient_id)
    VALUES (p_removed_profile_id, r.recipient_id)
    ON CONFLICT (profile_id, recipient_id) DO NOTHING;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- A conversation with a hidden account is not listed in the inbox, so the
    -- notice opens the inbox instead of a thread that would not load.
    v_url := CASE WHEN v_hidden THEN '/messages' ELSE '/messages/' || r.conversation_id::text END;

    v_nid := public.enqueue_notification(
      r.recipient_id,
      NULL,
      'system_announcement'::public.profile_notification_kind,
      p_removed_profile_id,
      jsonb_build_object(
        'notice', 'removed_account',
        'title', c_title,
        'summary', c_text,
        'target_url', v_url),
      v_url);

    UPDATE public.removed_account_notice_recipients
       SET notification_id = v_nid
     WHERE profile_id = p_removed_profile_id AND recipient_id = r.recipient_id;

    v_n := v_n + 1;
  END LOOP;

  UPDATE public.removed_account_notices
     SET notified_count = notified_count + v_n,
         last_sent_at = now()
   WHERE profile_id = p_removed_profile_id;

  PERFORM public.admin_log_action(
    'send_removed_account_notice', 'profile', p_removed_profile_id,
    NULL, jsonb_build_object('notified', v_n), '{}'::jsonb);

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_removed_account_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_removed_account_notice(uuid) TO authenticated, service_role;

-- For the chat: is the other member of MY conversation a removed account? Answers
-- false for anyone the caller has no conversation with, so the list cannot be read.
CREATE OR REPLACE FUNCTION public.is_removed_account(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_profile_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.removed_account_notices n WHERE n.profile_id = p_profile_id)
     AND EXISTS (
           SELECT 1 FROM public.conversations c
            WHERE least(c.participant_one_id, c.participant_two_id) = least(auth.uid(), p_profile_id)
              AND greatest(c.participant_one_id, c.participant_two_id) = greatest(auth.uid(), p_profile_id));
$$;

REVOKE ALL ON FUNCTION public.is_removed_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_removed_account(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
