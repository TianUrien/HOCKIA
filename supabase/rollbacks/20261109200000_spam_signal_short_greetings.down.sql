-- Rollback for 20261109200000_spam_signal_short_greetings.sql:
-- restores _track_first_message() from 20261004300000_new_conversation_limits.sql.
-- Backfilled hashes and signal rows are left in place (admin-only, harmless).

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

