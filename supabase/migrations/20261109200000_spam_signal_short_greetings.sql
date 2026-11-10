-- Spam signal: short greetings sent to many people count too.
--
-- Founder 2026-11-09. A member sent "Halo Honorable sir" (18 characters) as the
-- first message of 20 new conversations in four days; the repeated-first-message
-- signal ignored every first message under 20 characters, so admins were never
-- told. Now first messages of 10–19 normalised characters are compared as well
-- and raise the signal from 8 different people in 7 days (20+ characters keep the
-- bar of 5). Under 10 characters ("hi", "hello", "hola") is still ignored. Only
-- _track_first_message() changes; same grants, same trigger, nothing is blocked
-- automatically (the signal is admin-only).
--
-- Backfill: first messages of the last 30 days that were skipped for being short
-- get their hash and loose key from the stored first message, and members who
-- crossed the new bar get their signal row, so the case that prompted this shows
-- up in the admin list now.
--
-- Rollback: supabase/rollbacks/20261109200000_spam_signal_short_greetings.down.sql
-- (restores the function; backfilled hashes and signals stay, they are harmless).

CREATE OR REPLACE FUNCTION public._track_first_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_min_people       constant integer := 5;
  c_min_length       constant integer := 20;
  -- 2026-11-09: short greetings sent to many people count too, with a higher bar.
  c_min_people_short constant integer := 8;
  c_min_length_short constant integer := 10;
  v_threshold        integer;
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
    -- Very short greetings ("hi", "hello") are the same for everyone: not compared.
    -- 10–19 characters ("halo honorable sir") are compared, but need 8 people.
    IF length(v_norm) < c_min_length_short THEN
      UPDATE public.new_conversation_log SET first_message_at = v_now WHERE id = v_log_id;
      RETURN NULL;
    END IF;

    v_threshold := CASE WHEN length(v_norm) < c_min_length THEN c_min_people_short ELSE c_min_people END;
    v_hash  := md5(v_norm);
    v_loose := md5(left(v_norm, 80));

    UPDATE public.new_conversation_log
       SET first_message_at = v_now, first_message_hash = v_hash, first_message_loose_key = v_loose
     WHERE id = v_log_id;

    SELECT count(DISTINCT l.other_user_id) INTO v_people
      FROM public.new_conversation_log l
     WHERE l.user_id = NEW.sender_id
       AND l.first_message_loose_key = v_loose
       AND l.first_message_at > v_now - interval '7 days';

    -- Of those, the largest group that got exactly the same text.
    SELECT coalesce(max(g.people), 0) INTO v_identical
      FROM (SELECT count(DISTINCT l.other_user_id) AS people
              FROM public.new_conversation_log l
             WHERE l.user_id = NEW.sender_id
               AND l.first_message_loose_key = v_loose
               AND l.first_message_at > v_now - interval '7 days'
             GROUP BY l.first_message_hash) g;

    IF v_people >= v_threshold THEN
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


-- ═══ Backfill: the last 30 days ═══════════════════════════════════════════════
WITH firsts AS (
  SELECT l.id,
         public._normalise_first_message(m.content) AS norm
    FROM public.new_conversation_log l
    JOIN LATERAL (
      SELECT mm.content
        FROM public.messages mm
       WHERE mm.conversation_id = l.conversation_id
         AND mm.sender_id = l.user_id
         AND (mm.metadata IS NULL OR jsonb_typeof(mm.metadata) = 'null')
       ORDER BY mm.sent_at
       LIMIT 1
    ) m ON true
   WHERE l.first_message_at IS NOT NULL
     AND l.first_message_hash IS NULL
     AND l.first_message_at > now() - interval '30 days'
)
UPDATE public.new_conversation_log l
   SET first_message_hash = md5(f.norm),
       first_message_loose_key = md5(left(f.norm, 80))
  FROM firsts f
 WHERE f.id = l.id
   AND length(f.norm) BETWEEN 10 AND 19;

WITH grp AS (
  SELECT l.user_id, l.first_message_loose_key AS loose,
         count(DISTINCT l.other_user_id) AS people,
         min(l.first_message_at) AS first_seen, max(l.first_message_at) AS last_seen
    FROM public.new_conversation_log l
   WHERE l.first_message_loose_key IS NOT NULL
     AND l.first_message_at > now() - interval '30 days'
   GROUP BY 1, 2
), hit AS (
  -- 8+ people inside any 7-day window: approximated by the group's span.
  SELECT g.* FROM grp g WHERE g.people >= 8 AND g.last_seen - g.first_seen <= interval '7 days'
)
INSERT INTO public.spam_signals AS s (user_id, kind, signal_key, people_count, identical_count, sample_text, first_seen_at, last_seen_at)
SELECT h.user_id, 'repeated_first_message', h.loose, h.people, h.people,
       (SELECT left(btrim(mm.content), 300)
          FROM public.new_conversation_log l2
          JOIN public.messages mm ON mm.conversation_id = l2.conversation_id AND mm.sender_id = l2.user_id
         WHERE l2.user_id = h.user_id AND l2.first_message_loose_key = h.loose
         ORDER BY mm.sent_at LIMIT 1),
       h.first_seen, h.last_seen
  FROM hit h
ON CONFLICT ON CONSTRAINT spam_signals_user_kind_key_unique DO UPDATE
  SET people_count = greatest(s.people_count, excluded.people_count),
      identical_count = greatest(coalesce(s.identical_count, 0), excluded.identical_count),
      last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at);
