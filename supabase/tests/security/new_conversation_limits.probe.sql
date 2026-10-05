-- Probe for 20261004300000_new_conversation_limits.sql: the daily allowance for new
-- conversations, who is exempt, the two admin signals and the removed-account notice.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement, including the three
-- helper functions it creates for itself.
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated + request.jwt.claims,
-- exactly like PostgREST does (inside the helpers). "sys" steps run as the database
-- owner with no JWT. The "other people" are ordinary staging profiles picked at run
-- time; they only ever receive rows that are rolled back.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  c_refusal constant text := 'You''ve started a lot of new conversations today. You can start more tomorrow.';
  c_notice  constant text := 'An account that messaged you has been removed for spam. Hockia will never ask you for money. Don''t send money, crypto or personal details to people you haven''t met, and be careful if someone asks to move to WhatsApp or another app. If something feels off, tap Report.';
  v_others uuid[];
  v_res text; v_txt text; v_id uuid; v_conv uuid;
  v_n int; v_m int; v_k int; v_expected int;
  v_ok int; v_bool boolean; v_bool2 boolean;
  i int;
  v_out text := '';
BEGIN
  -- ── helpers (rolled back with everything else) ─────────────────────────────────
  -- Start a conversation as a signed-in member. 'ok:<id>' or 'ERR:<message>|<detail>'.
  EXECUTE $f$
    CREATE FUNCTION public._probe_start(p_actor uuid, p_other uuid, p_mode text DEFAULT 'client')
    RETURNS text LANGUAGE plpgsql AS $body$
    DECLARE v_id uuid; v_msg text; v_detail text;
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', p_actor, 'role', 'authenticated',
                          'app_metadata', json_build_object('is_admin', p_mode = 'admin'))::text, true);
      BEGIN
        EXECUTE 'SET LOCAL ROLE authenticated';
        IF p_mode = 'definer' THEN
          v_id := public._probe_definer_start(p_actor, p_other);
        ELSE
          INSERT INTO public.conversations (participant_one_id, participant_two_id, origin)
          VALUES (p_actor, p_other, 'Direct') RETURNING id INTO v_id;
        END IF;
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claims', '', true);
        RETURN 'ok:' || v_id::text;
      EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        v_msg := SQLERRM;
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claims', '', true);
        RETURN 'ERR:' || v_msg || '|' || coalesce(v_detail, '');
      END;
    END $body$
  $f$;
  -- What a server function does: the insert runs inside SECURITY DEFINER.
  EXECUTE $f$
    CREATE FUNCTION public._probe_definer_start(p_a uuid, p_b uuid)
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
    DECLARE v_id uuid;
    BEGIN
      INSERT INTO public.conversations (participant_one_id, participant_two_id, origin)
      VALUES (p_a, p_b, 'Recruiting') RETURNING id INTO v_id;
      RETURN v_id;
    END $body$
  $f$;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._probe_definer_start(uuid, uuid) TO authenticated';
  -- Send a message as a signed-in member. 'ok' or 'ERR:<message>'.
  EXECUTE $f$
    CREATE FUNCTION public._probe_say(p_actor uuid, p_conversation uuid, p_text text)
    RETURNS text LANGUAGE plpgsql AS $body$
    DECLARE v_msg text;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
      BEGIN
        EXECUTE 'SET LOCAL ROLE authenticated';
        INSERT INTO public.messages (conversation_id, sender_id, content) VALUES (p_conversation, p_actor, p_text);
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claims', '', true);
        RETURN 'ok';
      EXCEPTION WHEN others THEN
        v_msg := SQLERRM;
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claims', '', true);
        RETURN 'ERR:' || v_msg;
      END;
    END $body$
  $f$;

  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);

  -- 40 ordinary, contactable profiles with no conversation and no block with the fixtures.
  SELECT array_agg(x.id) INTO v_others FROM (
    SELECT p.id FROM profiles p
     WHERE p.id NOT IN (c_club, c_coach, c_player)
       AND coalesce(p.onboarding_completed, false)
       AND NOT profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
       AND NOT EXISTS (SELECT 1 FROM conversations c
                        WHERE (c.participant_one_id = p.id AND c.participant_two_id IN (c_club, c_coach, c_player))
                           OR (c.participant_two_id = p.id AND c.participant_one_id IN (c_club, c_coach, c_player)))
       AND NOT EXISTS (SELECT 1 FROM user_blocks b
                        WHERE (b.blocker_id = p.id AND b.blocked_id IN (c_club, c_coach, c_player))
                           OR (b.blocked_id = p.id AND b.blocker_id IN (c_club, c_coach, c_player)))
     ORDER BY p.created_at, p.id
     LIMIT 40) x;
  IF coalesce(array_length(v_others, 1), 0) < 40 THEN
    RAISE EXCEPTION 'PROBE RESULTS:%', E'\nFAIL fixtures → fewer than 40 usable profiles on this database (' || coalesce(array_length(v_others, 1), 0) || ')';
  END IF;

  DELETE FROM new_conversation_log WHERE user_id IN (c_club, c_coach, c_player);
  DELETE FROM spam_signals WHERE user_id IN (c_club, c_coach, c_player);
  DELETE FROM removed_account_notices WHERE profile_id IN (c_club, c_coach, c_player);
  UPDATE profiles SET is_test_account = false, is_blocked = false, created_at = now() - interval '30 days' WHERE id = c_player;
  UPDATE profiles SET is_test_account = false, is_blocked = false, created_at = now() - interval '30 days' WHERE id = c_club;
  UPDATE profiles SET is_test_account = false, is_blocked = false, created_at = now() - interval '30 days',
                      coach_recruits_for_team = false WHERE id = c_coach;

  -- ── A · the allowance by account ───────────────────────────────────────────────
  SELECT _new_conversation_daily_limit(c_player), _new_conversation_daily_limit(c_club), _new_conversation_daily_limit(c_coach)
    INTO v_n, v_m, v_k;
  v_out := v_out || E'\n' || format('%s A1 after day 7: player %s, club %s, coach who does not recruit %s (want 15, 30, 15)',
    CASE WHEN v_n = 15 AND v_m = 30 AND v_k = 15 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m, v_k);

  UPDATE profiles SET coach_recruits_for_team = true WHERE id = c_coach;
  v_n := _new_conversation_daily_limit(c_coach);
  v_out := v_out || E'\n' || format('%s A2 coach who recruits → %s (want 30)', CASE WHEN v_n = 30 THEN 'PASS' ELSE 'FAIL' END, v_n);

  UPDATE profiles SET created_at = now() - interval '6 days 23 hours' WHERE id IN (c_player, c_club, c_coach);
  SELECT _new_conversation_daily_limit(c_player), _new_conversation_daily_limit(c_club), _new_conversation_daily_limit(c_coach)
    INTO v_n, v_m, v_k;
  v_out := v_out || E'\n' || format('%s A3 first 7 days: player %s, club %s, recruiting coach %s (want 5, 5, 5)',
    CASE WHEN v_n = 5 AND v_m = 5 AND v_k = 5 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m, v_k);

  UPDATE profiles SET is_test_account = true WHERE id = c_coach;
  v_n := _new_conversation_daily_limit(c_coach);
  v_out := v_out || E'\n' || format('%s A4 test account → %s (want NULL = exempt); unknown profile → %s',
    CASE WHEN v_n IS NULL AND _new_conversation_daily_limit(gen_random_uuid()) IS NULL THEN 'PASS' ELSE 'FAIL' END,
    coalesce(v_n::text, 'NULL'), coalesce(_new_conversation_daily_limit(gen_random_uuid())::text, 'NULL'));
  UPDATE profiles SET is_test_account = false, created_at = now() - interval '30 days' WHERE id = c_coach;
  UPDATE profiles SET created_at = now() - interval '30 days' WHERE id = c_club;

  -- ── B · a new account: 5 starts, the 6th refused ───────────────────────────────
  -- (c_player's account is 6 days 23 hours old here)
  v_ok := 0;
  FOR i IN 1..5 LOOP
    v_res := _probe_start(c_player, v_others[i]);
    IF v_res LIKE 'ok:%' THEN v_ok := v_ok + 1; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM new_conversation_log WHERE user_id = c_player;
  v_out := v_out || E'\n' || format('%s B1 five starts allowed → %s ok, %s log rows (last result %s)',
    CASE WHEN v_ok = 5 AND v_n = 5 THEN 'PASS' ELSE 'FAIL' END, v_ok, v_n, left(v_res, 60));

  SELECT count(*), max(people_count) INTO v_n, v_m FROM spam_signals WHERE user_id = c_player AND kind = 'daily_limit';
  v_out := v_out || E'\n' || format('%s B2 using the whole allowance writes one daily_limit signal → %s row(s), people %s',
    CASE WHEN v_n = 1 AND v_m = 5 THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_m::text, 'NULL'));

  v_res := _probe_start(c_player, v_others[6]);
  SELECT count(*) INTO v_n FROM conversations
   WHERE least(participant_one_id, participant_two_id) = least(c_player, v_others[6])
     AND greatest(participant_one_id, participant_two_id) = greatest(c_player, v_others[6]);
  SELECT count(*) INTO v_m FROM new_conversation_log WHERE user_id = c_player;
  v_out := v_out || E'\n' || format('%s B3 the sixth is refused with the exact text and code, nothing left behind → %s · conversations %s · log rows %s',
    CASE WHEN v_res = 'ERR:' || c_refusal || '|new_conversation_limit' AND v_n = 0 AND v_m = 5 THEN 'PASS' ELSE 'FAIL' END,
    v_res, v_n, v_m);

  -- B4 a message in an existing conversation is not limited
  SELECT conversation_id INTO v_conv FROM new_conversation_log WHERE user_id = c_player AND other_user_id = v_others[1];
  v_res := _probe_say(c_player, v_conv, 'Hello, this is a normal first message.');
  v_txt := _probe_say(c_player, v_conv, 'And a second one.');
  v_out := v_out || E'\n' || format('%s B4 at the allowance, messages in an existing conversation still send → %s, %s',
    CASE WHEN v_res = 'ok' AND v_txt = 'ok' THEN 'PASS' ELSE 'FAIL' END, v_res, v_txt);

  -- B5 the other person replying uses none of their allowance
  v_res := _probe_say(v_others[1], v_conv, 'A reply.');
  SELECT count(*) INTO v_n FROM new_conversation_log WHERE user_id = v_others[1];
  v_out := v_out || E'\n' || format('%s B5 a reply is not counted → %s, log rows for the replier %s',
    CASE WHEN v_res = 'ok' AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);

  -- B6 deleting a conversation does not give the allowance back
  DELETE FROM conversations WHERE id = (SELECT conversation_id FROM new_conversation_log WHERE user_id = c_player AND other_user_id = v_others[2]);
  v_res := _probe_start(c_player, v_others[6]);
  v_out := v_out || E'\n' || format('%s B6 after deleting one conversation a new person is still refused → %s',
    CASE WHEN v_res LIKE 'ERR:' || c_refusal || '%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 90));

  -- B7 starting again with the same person is not a new person
  v_res := _probe_start(c_player, v_others[2]);
  v_out := v_out || E'\n' || format('%s B7 starting again with the person whose conversation was deleted is allowed → %s',
    CASE WHEN v_res LIKE 'ok:%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60));

  -- B8 an existing pair still answers with the unique violation (the client relies on it)
  v_res := _probe_start(c_player, v_others[1]);
  v_out := v_out || E'\n' || format('%s B8 a pair that already has a conversation → %s',
    CASE WHEN v_res ILIKE 'ERR:%duplicate key%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 90));

  -- B9 the refusal counter (an up-to-date client reports it)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM log_new_conversation_refusal();
  PERFORM log_new_conversation_refusal();
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*), max(refusal_count) INTO v_n, v_m FROM spam_signals WHERE user_id = c_player AND kind = 'daily_limit';
  v_out := v_out || E'\n' || format('%s B9 two reported refusals → %s row(s), refusal_count %s',
    CASE WHEN v_n = 1 AND v_m = 2 THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_m::text, 'NULL'));

  -- B10 rolling 24 hours: starts older than a day no longer count
  UPDATE new_conversation_log SET created_at = created_at - interval '24 hours 1 minute' WHERE user_id = c_player;
  v_res := _probe_start(c_player, v_others[6]);
  v_out := v_out || E'\n' || format('%s B10 a day later the allowance is back → %s', CASE WHEN v_res LIKE 'ok:%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60));

  -- B11 below the allowance the refusal report does nothing
  SELECT refusal_count INTO v_m FROM spam_signals WHERE user_id = c_player AND kind = 'daily_limit' ORDER BY last_seen_at DESC LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM log_new_conversation_refusal();
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT sum(refusal_count) INTO v_n FROM spam_signals WHERE user_id = c_player AND kind = 'daily_limit';
  v_out := v_out || E'\n' || format('%s B11 a refusal report below the allowance is ignored → total refusals %s (before %s)',
    CASE WHEN v_n = v_m THEN 'PASS' ELSE 'FAIL' END, v_n, v_m);

  -- ── C · after day 7: 15 for a player, 30 for a club ────────────────────────────
  DELETE FROM new_conversation_log WHERE user_id = c_player;
  UPDATE profiles SET created_at = now() - interval '30 days' WHERE id = c_player;
  INSERT INTO new_conversation_log (user_id, other_user_id) SELECT c_player, v_others[g] FROM generate_series(7, 20) g;  -- 14 people
  v_res := _probe_start(c_player, v_others[21]);
  v_txt := _probe_start(c_player, v_others[22]);
  v_out := v_out || E'\n' || format('%s C1 player after day 7: the 15th is allowed, the 16th refused → %s · %s',
    CASE WHEN v_res LIKE 'ok:%' AND v_txt LIKE 'ERR:' || c_refusal || '%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 12), left(v_txt, 90));

  INSERT INTO new_conversation_log (user_id, other_user_id) SELECT c_club, v_others[g] FROM generate_series(1, 29) g;  -- 29 people
  v_res := _probe_start(c_club, v_others[30]);
  v_txt := _probe_start(c_club, v_others[31]);
  v_out := v_out || E'\n' || format('%s C2 club after day 7: the 30th is allowed, the 31st refused → %s · %s',
    CASE WHEN v_res LIKE 'ok:%' AND v_txt LIKE 'ERR:' || c_refusal || '%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 12), left(v_txt, 90));

  -- ── D · who is not limited ─────────────────────────────────────────────────────
  -- D1 the club is at its allowance; a conversation opened inside a SECURITY DEFINER
  --    function (what send_invite / make_offer do) is neither refused nor counted
  SELECT count(*) INTO v_n FROM new_conversation_log WHERE user_id = c_club;
  v_res := _probe_start(c_club, v_others[32], 'definer');
  SELECT count(*) INTO v_m FROM new_conversation_log WHERE user_id = c_club;
  v_out := v_out || E'\n' || format('%s D1 opened by a server function while at the allowance → %s, log rows %s → %s',
    CASE WHEN v_res LIKE 'ok:%' AND v_m = v_n THEN 'PASS' ELSE 'FAIL' END, left(v_res, 12), v_n, v_m);

  -- D2 the real helper the recruiting functions use, as sys with the club's JWT
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  v_id := _recruiting_conversation(c_club, v_others[33], 'Recruiting');
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_m FROM new_conversation_log WHERE user_id = c_club;
  v_out := v_out || E'\n' || format('%s D2 _recruiting_conversation at the allowance → conversation %s, log rows still %s',
    CASE WHEN v_id IS NOT NULL AND v_m = v_n THEN 'PASS' ELSE 'FAIL' END, v_id IS NOT NULL, v_m);

  -- D3 the same person as a client is refused (the control for D1 / D2)
  v_res := _probe_start(c_club, v_others[34]);
  v_out := v_out || E'\n' || format('%s D3 control: the same club as a client is refused → %s',
    CASE WHEN v_res LIKE 'ERR:' || c_refusal || '%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 90));

  -- D4 an admin is not limited and not counted
  v_res := _probe_start(c_club, v_others[34], 'admin');
  SELECT count(*) INTO v_m FROM new_conversation_log WHERE user_id = c_club;
  v_out := v_out || E'\n' || format('%s D4 with the admin claim → %s, log rows still %s',
    CASE WHEN v_res LIKE 'ok:%' AND v_m = v_n THEN 'PASS' ELSE 'FAIL' END, left(v_res, 12), v_m);

  -- D5 a test account is not limited and not counted
  UPDATE profiles SET is_test_account = true WHERE id = c_club;
  v_res := _probe_start(c_club, v_others[35]);
  SELECT count(*) INTO v_m FROM new_conversation_log WHERE user_id = c_club;
  v_out := v_out || E'\n' || format('%s D5 test account → %s, log rows still %s',
    CASE WHEN v_res LIKE 'ok:%' AND v_m = v_n THEN 'PASS' ELSE 'FAIL' END, left(v_res, 12), v_m);
  UPDATE profiles SET is_test_account = false WHERE id = c_club;

  -- D6 a member cannot start a conversation between two other people (RLS, as before)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO conversations (participant_one_id, participant_two_id) VALUES (v_others[37], v_others[38]);
    EXECUTE 'RESET ROLE';
    v_txt := 'allowed';
  EXCEPTION WHEN others THEN
    v_txt := SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s D6 a conversation between two other people → %s',
    CASE WHEN v_txt ILIKE '%row-level security%' THEN 'PASS' ELSE 'FAIL' END, left(v_txt, 80));

  -- ── E · repeated first message ─────────────────────────────────────────────────
  DELETE FROM new_conversation_log WHERE user_id = c_coach;
  DELETE FROM spam_signals WHERE user_id = c_coach;
  UPDATE profiles SET coach_recruits_for_team = true WHERE id = c_coach;   -- 30 a day

  -- four people, the same text with different numbers, punctuation and case
  FOR i IN 1..4 LOOP
    v_res := _probe_start(c_coach, v_others[i]);
    v_txt := _probe_say(c_coach, substr(v_res, 4)::uuid,
      CASE i WHEN 1 THEN 'Hello! I can offer you a great contract with a top club in Europe next season, please write to me on +44 7000 000001 today.'
             WHEN 2 THEN 'hello i can offer you a GREAT contract with a top club in Europe next season... please write to me on +44 7000 000002 today!!'
             WHEN 3 THEN 'Hello, I can offer you a great contract with a top club in Europe next season; please write to me on 0044-7000-000003 today'
             ELSE        'HELLO I CAN OFFER YOU A GREAT CONTRACT WITH A TOP CLUB IN EUROPE NEXT SEASON PLEASE WRITE TO ME ON 4 TODAY' END);
  END LOOP;
  SELECT count(*) INTO v_n FROM spam_signals WHERE user_id = c_coach AND kind = 'repeated_first_message';
  SELECT count(DISTINCT first_message_hash), count(first_message_hash) INTO v_m, v_k FROM new_conversation_log WHERE user_id = c_coach;
  v_out := v_out || E'\n' || format('%s E1 four people, same text apart from digits/punctuation/case → %s signal(s); %s first messages keyed, %s distinct hash (last send %s)',
    CASE WHEN v_n = 0 AND v_k = 4 AND v_m = 1 THEN 'PASS' ELSE 'FAIL' END, v_n, v_k, v_m, v_txt);

  -- the fifth person: the same first 80 letters, a different ending → near-identical
  v_res := _probe_start(c_coach, v_others[5]);
  v_txt := _probe_say(c_coach, substr(v_res, 4)::uuid,
    'Hello! I can offer you a great contract with a top club in Europe next season, please reply here and I will send every detail.');
  SELECT count(*), max(people_count), max(identical_count), max(sample_text) INTO v_n, v_m, v_k, v_res
    FROM spam_signals WHERE user_id = c_coach AND kind = 'repeated_first_message';
  v_out := v_out || E'\n' || format('%s E2 the fifth person (near-identical) → %s signal, people %s, identical %s, sample "%s"',
    CASE WHEN v_n = 1 AND v_m = 5 AND v_k = 4 AND v_res LIKE 'Hello! I can offer you a great contract%' THEN 'PASS' ELSE 'FAIL' END,
    v_n, coalesce(v_m::text, 'NULL'), coalesce(v_k::text, 'NULL'), left(coalesce(v_res, 'NULL'), 40));

  -- E3 a second message in one of those conversations is not a first message
  SELECT conversation_id INTO v_conv FROM new_conversation_log WHERE user_id = c_coach AND other_user_id = v_others[1];
  v_txt := _probe_say(c_coach, v_conv, 'Hello! I can offer you a great contract with a top club in Europe next season, please write to me on +44 7000 000001 today.');
  SELECT max(people_count) INTO v_m FROM spam_signals WHERE user_id = c_coach AND kind = 'repeated_first_message';
  v_out := v_out || E'\n' || format('%s E3 a later message in the same conversation changes nothing → people %s',
    CASE WHEN v_m = 5 THEN 'PASS' ELSE 'FAIL' END, v_m);

  -- E4 short greetings are never compared
  FOR i IN 6..11 LOOP
    v_res := _probe_start(c_coach, v_others[i]);
    v_txt := _probe_say(c_coach, substr(v_res, 4)::uuid, 'Hi there!');
  END LOOP;
  SELECT count(*) INTO v_n FROM spam_signals WHERE user_id = c_coach AND kind = 'repeated_first_message';
  SELECT count(*) INTO v_m FROM new_conversation_log WHERE user_id = c_coach AND first_message_at IS NOT NULL AND first_message_hash IS NULL;
  v_out := v_out || E'\n' || format('%s E4 "Hi there!" to six people → still %s signal, %s first messages marked without a key',
    CASE WHEN v_n = 1 AND v_m = 6 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m);

  -- E5 no message text is stored per recipient
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'new_conversation_log'
     AND (column_name ILIKE '%content%' OR column_name ILIKE '%sample%' OR column_name ILIKE '%text%');
  v_out := v_out || E'\n' || format('%s E5 the log has no text column → %s', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── F · the admin list ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM admin_get_spam_signals(30, 50, 0);
    EXECUTE 'RESET ROLE';
    v_txt := 'allowed';
  EXCEPTION WHEN others THEN
    v_txt := SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  v_out := v_out || E'\n' || format('%s F1 a member calls admin_get_spam_signals → %s', CASE WHEN v_txt = 'Unauthorized' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_club, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (j->>'total')::int,
         (SELECT count(*) FROM jsonb_array_elements(j->'rows') e
           WHERE e->>'profile_id' = c_coach::text AND e->>'kind' = 'repeated_first_message'
             AND (e->>'people_count')::int = 5 AND e->>'sample_text' IS NOT NULL AND e ? 'is_blocked' AND e ? 'account_created_at'),
         (SELECT count(*) FROM jsonb_array_elements(j->'rows') e
           WHERE e->>'kind' = 'daily_limit' AND e->>'sample_text' IS NOT NULL)
    INTO v_n, v_m, v_k
    FROM (SELECT admin_get_spam_signals(30, 200, 0) AS j) q;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s F2 an admin gets the list → total %s, the coach''s repeated-message row %s, daily_limit rows with a sample %s',
    CASE WHEN v_n >= 2 AND v_m = 1 AND v_k = 0 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m, v_k);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM 1 FROM spam_signals LIMIT 1;
    EXECUTE 'RESET ROLE';
    v_txt := 'allowed';
  EXCEPTION WHEN others THEN
    v_txt := SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM 1 FROM new_conversation_log LIMIT 1;
    EXECUTE 'RESET ROLE';
    v_res := 'allowed';
  EXCEPTION WHEN others THEN
    v_res := SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s F3 a member reads the tables directly → %s · %s',
    CASE WHEN v_txt ILIKE '%permission denied%' AND v_res ILIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END, v_txt, v_res);

  -- ── G · removed-account notice ─────────────────────────────────────────────────
  -- The coach is the removed account. It has messages with v_others[1..11] from E.
  SELECT count(DISTINCT x.other_id) INTO v_expected FROM (
    SELECT CASE WHEN c.participant_one_id = c_coach THEN c.participant_two_id ELSE c.participant_one_id END AS other_id
      FROM conversations c
     WHERE (c.participant_one_id = c_coach OR c.participant_two_id = c_coach)
       AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)) x
    JOIN profiles rp ON rp.id = x.other_id
   WHERE NOT profile_is_hidden(rp.is_blocked, rp.frozen_minor_at);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM admin_send_removed_account_notice(c_coach);
    EXECUTE 'RESET ROLE';
    v_txt := 'allowed';
  EXCEPTION WHEN others THEN
    v_txt := SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM removed_account_notices WHERE profile_id = c_coach;
  v_out := v_out || E'\n' || format('%s G1 a member calls admin_send_removed_account_notice → %s, marked %s',
    CASE WHEN v_txt = 'Unauthorized' AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_txt, v_n);

  -- before: nobody sees the account as removed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_others[1], 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_bool := is_removed_account(c_coach);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s G2 before the notice, is_removed_account → %s', CASE WHEN v_bool = false THEN 'PASS' ELSE 'FAIL' END, v_bool);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_club, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_n := admin_send_removed_account_notice(c_coach);
  v_m := admin_send_removed_account_notice(c_coach);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s G3 first call notifies everyone once, the second nobody → %s (want %s, at least 11), then %s',
    CASE WHEN v_n = v_expected AND v_n >= 11 AND v_m = 0 THEN 'PASS' ELSE 'FAIL' END, v_n, v_expected, v_m);

  SELECT count(*), count(DISTINCT recipient_profile_id),
         count(*) FILTER (WHERE metadata->>'title' = 'A message about your safety' AND metadata->>'summary' = c_notice
                            AND actor_profile_id IS NULL AND read_at IS NULL)
    INTO v_n, v_m, v_k
    FROM profile_notifications
   WHERE kind = 'system_announcement' AND source_entity_id = c_coach;
  v_out := v_out || E'\n' || format('%s G4 one notification per person with the exact title and text → %s rows, %s people, %s exact (want %s each)',
    CASE WHEN v_n = v_expected AND v_m = v_expected AND v_k = v_expected THEN 'PASS' ELSE 'FAIL' END, v_n, v_m, v_k, v_expected);

  SELECT count(*) INTO v_n FROM profile_notifications
   WHERE kind = 'system_announcement' AND source_entity_id = c_coach AND recipient_profile_id = c_coach;
  SELECT notified_count INTO v_m FROM removed_account_notices WHERE profile_id = c_coach;
  SELECT count(*) INTO v_k FROM admin_audit_logs WHERE action = 'send_removed_account_notice' AND target_id = c_coach;
  v_out := v_out || E'\n' || format('%s G5 the removed account gets none; the total and the audit log are kept → to itself %s, notified_count %s, audit rows %s',
    CASE WHEN v_n = 0 AND v_m = v_expected AND v_k = 2 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m, v_k);

  -- G6 someone the account talks to later is notified by a later call, the others not again
  v_conv := _recruiting_conversation(c_coach, v_others[39], 'Recruiting');
  INSERT INTO messages (conversation_id, sender_id, content) VALUES (v_conv, c_coach, '[PROBE] later message');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_club, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_n := admin_send_removed_account_notice(c_coach);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_m FROM profile_notifications WHERE kind = 'system_announcement' AND source_entity_id = c_coach;
  v_out := v_out || E'\n' || format('%s G6 a later conversation → %s notified by the next call, %s notifications in total (want 1, %s)',
    CASE WHEN v_n = 1 AND v_m = v_expected + 1 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m, v_expected + 1);

  -- G7 who can see that the account is removed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_others[1], 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_bool := is_removed_account(c_coach);
  v_bool2 := is_removed_account(c_club);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s G7 someone with a conversation: the removed account → %s, another account → %s',
    CASE WHEN v_bool = true AND v_bool2 = false THEN 'PASS' ELSE 'FAIL' END, v_bool, v_bool2);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_others[40], 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_bool := is_removed_account(c_coach);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s G8 someone with no conversation with it → %s', CASE WHEN v_bool = false THEN 'PASS' ELSE 'FAIL' END, v_bool);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    v_bool := is_removed_account(c_coach);
    EXECUTE 'RESET ROLE';
    v_txt := 'allowed ' || v_bool;
  EXCEPTION WHEN others THEN
    v_txt := SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s G9 anon executes is_removed_account → %s', CASE WHEN v_txt ILIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_others[1], 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM 1 FROM removed_account_notices LIMIT 1;
    EXECUTE 'RESET ROLE';
    v_txt := 'allowed';
  EXCEPTION WHEN others THEN
    v_txt := SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s G10 a member reads removed_account_notices directly → %s', CASE WHEN v_txt ILIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
