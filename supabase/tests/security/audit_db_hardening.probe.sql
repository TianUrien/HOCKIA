-- Probe for 20261006100000_audit_db_hardening.sql: behaviour with fixtures.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement, including the
-- helper functions it creates for itself.
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE + request.jwt.claims inside the helper,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT.
-- Note: check_rate_limit records with created_at = now() (the transaction time) under
-- UNIQUE (identifier, action_type, created_at), so each identifier/action pair is
-- exercised at most once below.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (made a non-frozen under-18 below)
  c_minor_msg   constant text := 'This member can''t be contacted by clubs or coaches.';
  c_locked_msg  constant text := 'Only Hockia can change this club detail.';
  v_adult uuid;        -- an ordinary adult player, no conversation with the fixtures
  v_country int; v_league int;
  v_w1 uuid; v_w2 uuid; v_conv uuid;
  v_res text; v_txt text; v_t3 text; v_n int; v_m int; v_k int;
  i int;
  v_out text := '';
BEGIN
  -- ── helper (rolled back with everything else) ─────────────────────────────────
  -- Run one scalar SQL statement as p_role ('authenticated' with p_actor's JWT, or
  -- 'anon'). Returns 'ok:<first column>' or 'ERR:<message>|<detail>'.
  EXECUTE $f$
    CREATE FUNCTION public._probe_run(p_actor uuid, p_sql text, p_admin boolean DEFAULT false, p_role text DEFAULT 'authenticated')
    RETURNS text LANGUAGE plpgsql AS $body$
    DECLARE v_val text; v_msg text; v_detail text;
    BEGIN
      IF p_role = 'anon' THEN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      ELSE
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', p_actor, 'role', 'authenticated',
                            'app_metadata', json_build_object('is_admin', p_admin))::text, true);
      END IF;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', p_role);
        EXECUTE p_sql INTO v_val;
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claims', '', true);
        RETURN 'ok:' || coalesce(v_val, '');
      EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        v_msg := SQLERRM;
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claims', '', true);
        RETURN 'ERR:' || v_msg || '|' || coalesce(v_detail, '');
      END;
    END $body$
  $f$;

  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT p.id INTO v_adult FROM profiles p
   WHERE p.id NOT IN (c_club, c_coach, c_player)
     AND p.role = 'player'
     AND coalesce(p.onboarding_completed, false)
     AND public.profile_is_adult(p.date_of_birth)
     AND NOT profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
     AND NOT EXISTS (SELECT 1 FROM conversations c
                      WHERE (c.participant_one_id = p.id AND c.participant_two_id IN (c_club, c_coach, c_player))
                         OR (c.participant_two_id = p.id AND c.participant_one_id IN (c_club, c_coach, c_player)))
     AND NOT EXISTS (SELECT 1 FROM user_blocks b
                      WHERE (b.blocker_id = p.id AND b.blocked_id IN (c_club, c_coach, c_player))
                         OR (b.blocked_id = p.id AND b.blocker_id IN (c_club, c_coach, c_player)))
   ORDER BY p.created_at, p.id
   LIMIT 1;
  SELECT id INTO v_country FROM countries ORDER BY id LIMIT 1;
  SELECT id INTO v_league FROM world_leagues ORDER BY id LIMIT 1;
  IF v_adult IS NULL OR v_country IS NULL OR v_league IS NULL THEN
    RAISE EXCEPTION 'PROBE RESULTS:%', E'\nFAIL fixtures → need an adult player, a country and a league on this database';
  END IF;

  DELETE FROM new_conversation_log WHERE user_id IN (c_club, c_coach, c_player, v_adult);
  DELETE FROM user_blocks WHERE blocker_id IN (c_club, c_coach, c_player) OR blocked_id IN (c_club, c_coach, c_player);
  DELETE FROM conversations
   WHERE (participant_one_id IN (c_club, c_coach, c_player) AND participant_two_id IN (c_club, c_coach, c_player, v_adult))
      OR (participant_two_id IN (c_club, c_coach, c_player) AND participant_one_id IN (c_club, c_coach, c_player, v_adult));
  UPDATE profiles SET is_test_account = false, is_blocked = false, frozen_minor_at = NULL WHERE id IN (c_club, c_coach, c_player);
  UPDATE profiles SET coach_recruits_for_team = false WHERE id = c_coach;
  -- c_player becomes a NON-frozen under-18 (the DOB trigger freezes; clear it after).
  UPDATE profiles SET date_of_birth = (current_date - interval '16 years')::date WHERE id = c_player;
  UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_player;

  -- world clubs: W1 claimed by the club, W2 unclaimed
  UPDATE world_clubs SET claimed_profile_id = NULL WHERE claimed_profile_id = c_club;
  INSERT INTO world_clubs (club_id, club_name, club_name_normalized, country_id, is_claimed, claimed_profile_id, claimed_at, created_from)
  VALUES ('probe_w1_' || gen_random_uuid(), '[probe] W1', '[probe] w1 ' || gen_random_uuid(), v_country, true, c_club, now(), 'admin')
  RETURNING id INTO v_w1;
  INSERT INTO world_clubs (club_id, club_name, club_name_normalized, country_id, created_from)
  VALUES ('probe_w2_' || gen_random_uuid(), '[probe] W2', '[probe] w2 ' || gen_random_uuid(), v_country, 'admin')
  RETURNING id INTO v_w2;

  -- ── A · world_clubs ────────────────────────────────────────────────────────────
  v_res := _probe_run(c_club, format('WITH u AS (UPDATE world_clubs SET verified_at = now() WHERE id = %L RETURNING 1) SELECT count(*) FROM u', v_w1));
  v_out := v_out || E'\n' || format('%s A1 owner sets verified_at → %s', CASE WHEN v_res LIKE 'ERR:' || c_locked_msg || '%' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_club, format('WITH u AS (UPDATE world_clubs SET club_name = ''[probe] renamed'' WHERE id = %L RETURNING 1) SELECT count(*) FROM u', v_w1));
  v_out := v_out || E'\n' || format('%s A2 owner renames the club → %s', CASE WHEN v_res LIKE 'ERR:' || c_locked_msg || '%' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_club, format('WITH u AS (UPDATE world_clubs SET claimed_profile_id = %L WHERE id = %L RETURNING 1) SELECT count(*) FROM u', c_coach, v_w1));
  v_out := v_out || E'\n' || format('%s A3 owner hands the claim to someone else → %s', CASE WHEN v_res LIKE 'ERR:' || c_locked_msg || '%' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_club, format('WITH u AS (UPDATE world_clubs SET avatar_url = ''https://example.invalid/crest.png'' WHERE id = %L RETURNING 1) SELECT count(*) FROM u', v_w1));
  v_out := v_out || E'\n' || format('%s A4 owner changes the crest (still allowed) → %s', CASE WHEN v_res = 'ok:1' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_coach, format('WITH u AS (UPDATE world_clubs SET verified_at = now(), verified_by = %L WHERE id = %L RETURNING 1) SELECT count(*) FROM u', c_coach, v_w1), true);
  v_out := v_out || E'\n' || format('%s A5 an admin sets verified_at → %s', CASE WHEN v_res = 'ok:1' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_club, format('WITH u AS (UPDATE profiles SET mens_league_id = %s WHERE id = %L RETURNING 1) SELECT count(*) FROM u', v_league, c_club));
  SELECT men_league_id INTO v_n FROM world_clubs WHERE id = v_w1;
  v_out := v_out || E'\n' || format('%s A6 the club''s own league edit still reaches its world club (server sync) → %s, men_league_id %s',
    CASE WHEN v_res = 'ok:1' AND v_n = v_league THEN 'PASS' ELSE 'FAIL' END, v_res, coalesce(v_n::text, 'NULL'));

  v_res := _probe_run(c_club, format('SELECT claim_world_club(%L, %L)::text', v_w2, c_club));
  v_out := v_out || E'\n' || format('%s A7 a club holding a club claims a second one → %s',
    CASE WHEN v_res LIKE '%"success" : false%already linked to a club%' OR v_res LIKE '%"success":false%already linked to a club%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 140));

  v_res := _probe_run(c_club, format('SELECT create_and_claim_world_club(''[probe] brand new'', %s, NULL, %L)::text', v_country, c_club));
  v_out := v_out || E'\n' || format('%s A8 … or creates and claims a new one → %s',
    CASE WHEN v_res LIKE '%already linked to a club%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 140));

  UPDATE world_clubs SET claimed_profile_id = NULL WHERE id = v_w1;   -- sys: release W1
  v_res := _probe_run(c_club, format('SELECT claim_world_club(%L, %L)::text', v_w2, c_club));
  SELECT count(*) INTO v_n FROM world_clubs WHERE id = v_w2 AND claimed_profile_id = c_club;
  v_out := v_out || E'\n' || format('%s A9 control: with no club held, the claim works → %s, claimed %s',
    CASE WHEN v_res LIKE '%true%' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, left(v_res, 100), v_n);

  -- ── B · rate limits ────────────────────────────────────────────────────────────
  v_res := _probe_run(c_coach, format('SELECT check_message_rate_limit(%L)::text', v_adult));
  SELECT count(*) INTO v_n FROM rate_limits WHERE identifier = c_coach::text AND action_type = 'send_message' AND created_at = now();
  SELECT count(*) INTO v_m FROM rate_limits WHERE identifier = v_adult::text AND action_type = 'send_message' AND created_at = now();
  v_out := v_out || E'\n' || format('%s B1 check_message_rate_limit(someone else) counts against the caller → %s, caller rows %s, other rows %s',
    CASE WHEN v_res LIKE 'ok:%allowed%' AND v_n = 1 AND v_m = 0 THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60), v_n, v_m);

  v_res := _probe_run(c_coach, 'SELECT check_rate_limit(''probe'', ''probe'', 1, 60)::text');
  v_txt := _probe_run(NULL, 'SELECT check_rate_limit(''probe'', ''probe'', 1, 60)::text', false, 'anon');
  v_out := v_out || E'\n' || format('%s B2 check_rate_limit from a member / signed out → %s · %s',
    CASE WHEN v_res ILIKE 'ERR:permission denied%' AND v_txt ILIKE 'ERR:permission denied%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60), left(v_txt, 60));

  v_res := _probe_run(NULL, format('SELECT check_message_rate_limit(%L)::text', c_coach), false, 'anon');
  v_out := v_out || E'\n' || format('%s B3 signed out cannot use up a member''s message allowance → %s',
    CASE WHEN v_res ILIKE 'ERR:permission denied%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 70));

  v_n := 0;
  FOR i IN 1..6 LOOP
    v_res := _probe_run(NULL, 'SELECT (check_login_rate_limit(''probe-victim@example.invalid'')->>''allowed'')', false, 'anon');
    IF v_res = 'ok:true' THEN v_n := v_n + 1; END IF;
  END LOOP;
  SELECT count(*) INTO v_m FROM rate_limits WHERE identifier = 'probe-victim@example.invalid';
  v_out := v_out || E'\n' || format('%s B4 six signed-out sign-in pre-checks for one email: all allowed, nothing recorded → %s allowed, %s rows',
    CASE WHEN v_n = 6 AND v_m = 0 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m);

  v_res := _probe_run(c_coach, 'SELECT cleanup_rate_limits(24)::text');
  v_txt := _probe_run(c_coach, 'SELECT prune_old_heartbeats(90)::text');
  v_t3 := _probe_run(c_coach, 'SELECT prune_old_logs()::text');
  v_out := v_out || E'\n' || format('%s B5 maintenance functions from a member → %s · %s · %s',
    CASE WHEN v_res ILIKE 'ERR:permission denied%' AND v_txt ILIKE 'ERR:permission denied%' AND v_t3 ILIKE 'ERR:permission denied%' THEN 'PASS' ELSE 'FAIL' END,
    left(v_res, 40), left(v_txt, 40), left(v_t3, 40));

  -- ── C · profiles column writes ─────────────────────────────────────────────────
  v_res := _probe_run(c_coach, format('WITH u AS (UPDATE profiles SET email = ''probe@example.invalid'' WHERE id = %L RETURNING 1) SELECT count(*) FROM u', c_coach));
  v_txt := _probe_run(c_coach, format('WITH u AS (UPDATE profiles SET created_at = now() - interval ''5 years'' WHERE id = %L RETURNING 1) SELECT count(*) FROM u', c_coach));
  v_out := v_out || E'\n' || format('%s C1 a member updates own email / created_at → %s · %s',
    CASE WHEN v_res ILIKE 'ERR:permission denied%' AND v_txt ILIKE 'ERR:permission denied%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60), left(v_txt, 60));
  v_res := _probe_run(c_coach, format('WITH u AS (UPDATE profiles SET full_name = full_name, bio = bio WHERE id = %L RETURNING 1) SELECT count(*) FROM u', c_coach));
  v_out := v_out || E'\n' || format('%s C2 an ordinary profile save still works → %s', CASE WHEN v_res = 'ok:1' THEN 'PASS' ELSE 'FAIL' END, v_res);

  -- ── D · clubs, recruiting coaches and under-18s ────────────────────────────────
  v_res := _probe_run(c_club, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', c_club, c_player));
  v_out := v_out || E'\n' || format('%s D1 a club starts with an under-18 → %s',
    CASE WHEN v_res = 'ERR:' || c_minor_msg || '|recruiter_minor' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_player, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', c_player, c_club));
  v_out := v_out || E'\n' || format('%s D2 the under-18 starts with the club → %s',
    CASE WHEN v_res = 'ERR:' || c_minor_msg || '|recruiter_minor' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_coach, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', c_coach, c_player));
  v_out := v_out || E'\n' || format('%s D3 a coach who does not recruit starts with the under-18 → %s', CASE WHEN v_res LIKE 'ok:%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60));
  IF v_res LIKE 'ok:%' THEN DELETE FROM conversations WHERE id = substr(v_res, 4)::uuid; END IF;

  UPDATE profiles SET coach_recruits_for_team = true WHERE id = c_coach;
  v_res := _probe_run(c_coach, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', c_coach, c_player));
  v_out := v_out || E'\n' || format('%s D4 a recruiting coach starts with the under-18 → %s',
    CASE WHEN v_res = 'ERR:' || c_minor_msg || '|recruiter_minor' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(v_adult, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', v_adult, c_player));
  v_out := v_out || E'\n' || format('%s D5 an adult player (not a recruiter) starts with the under-18 → %s', CASE WHEN v_res LIKE 'ok:%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60));

  -- server path: a recruiting function opens it (not a client statement)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  v_conv := _recruiting_conversation(c_club, c_player, 'Recruiting');
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s D6 a server function may still open club ↔ under-18 → %s', CASE WHEN v_conv IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, v_conv IS NOT NULL);

  v_res := _probe_run(c_club, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', c_club, c_player));
  v_out := v_out || E'\n' || format('%s D7 existing pair: the client gets the duplicate (and then opens it), not the refusal → %s',
    CASE WHEN v_res ILIKE 'ERR:%duplicate key%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 80));

  v_res := _probe_run(c_club, format('INSERT INTO messages (conversation_id, sender_id, content) VALUES (%L, %L, ''[probe] hello'') RETURNING id', v_conv, c_club));
  v_txt := _probe_run(c_player, format('INSERT INTO messages (conversation_id, sender_id, content) VALUES (%L, %L, ''[probe] reply'') RETURNING id', v_conv, c_player));
  v_out := v_out || E'\n' || format('%s D8 messages in the existing conversation, both ways → %s · %s',
    CASE WHEN v_res LIKE 'ok:%' AND v_txt LIKE 'ok:%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 40), left(v_txt, 40));

  -- a FROZEN under-18 keeps the existing neutral sentence (nothing hints at an age)
  DELETE FROM conversations WHERE id = v_conv;
  UPDATE profiles SET frozen_minor_at = now() WHERE id = c_player;
  v_res := _probe_run(c_club, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', c_club, c_player));
  v_out := v_out || E'\n' || format('%s D9 a frozen under-18 → the neutral sentence, not the club rule → %s',
    CASE WHEN v_res LIKE 'ERR:This user is not available for messaging right now.%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 90));
  UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_player;
  UPDATE profiles SET coach_recruits_for_team = false WHERE id = c_coach;

  -- ── E · admin-blocked senders ──────────────────────────────────────────────────
  INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (c_coach, v_adult, 'Direct') RETURNING id INTO v_conv;  -- sys
  UPDATE profiles SET is_blocked = true WHERE id = c_coach;
  v_res := _probe_run(c_coach, format('INSERT INTO messages (conversation_id, sender_id, content) VALUES (%L, %L, ''[probe] x'') RETURNING id', v_conv, c_coach));
  v_out := v_out || E'\n' || format('%s E1 a blocked account sends in an existing conversation → %s',
    CASE WHEN v_res = 'ERR:You can''t send messages right now.|sender_unavailable' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(c_coach, format('INSERT INTO conversations (participant_one_id, participant_two_id, origin) VALUES (%L, %L, ''Direct'') RETURNING id', c_coach, c_club));
  v_out := v_out || E'\n' || format('%s E2 a blocked account starts a conversation → %s',
    CASE WHEN v_res = 'ERR:You can''t start conversations right now.|sender_unavailable' THEN 'PASS' ELSE 'FAIL' END, v_res);

  v_res := _probe_run(v_adult, format('INSERT INTO messages (conversation_id, sender_id, content) VALUES (%L, %L, ''[probe] y'') RETURNING id', v_conv, v_adult));
  v_out := v_out || E'\n' || format('%s E3 writing TO a blocked account keeps the existing neutral refusal → %s',
    CASE WHEN v_res LIKE 'ERR:This user is not available for messaging right now.%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 90));

  -- ── G · safety notice and unblock ──────────────────────────────────────────────
  UPDATE profiles SET is_blocked = false WHERE id = c_coach;
  INSERT INTO messages (conversation_id, sender_id, content) VALUES (v_conv, c_coach, '[probe] earlier message');  -- sys
  v_res := _probe_run(c_club, format('SELECT admin_send_removed_account_notice(%L)::text', c_coach), true);
  SELECT count(*) INTO v_n FROM removed_account_notices WHERE profile_id = c_coach;
  v_out := v_out || E'\n' || format('%s G1 notice for an account that is not blocked → %s, marked %s',
    CASE WHEN v_res = 'ERR:Block the account first.|account_not_blocked' AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);

  UPDATE profiles SET is_blocked = true WHERE id = c_coach;
  v_res := _probe_run(c_club, format('SELECT admin_send_removed_account_notice(%L)::text', c_coach), true);
  SELECT count(*) INTO v_n FROM removed_account_notices WHERE profile_id = c_coach;
  v_out := v_out || E'\n' || format('%s G2 once blocked, the notice goes out → %s, marked %s',
    CASE WHEN v_res ~ '^ok:[0-9]+$' AND substr(v_res, 4)::int >= 1 AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);

  v_res := _probe_run(c_club, format('SELECT admin_unblock_user(%L)::text', c_coach), true);
  SELECT count(*) INTO v_n FROM removed_account_notices WHERE profile_id = c_coach;
  SELECT count(*) INTO v_m FROM profiles WHERE id = c_coach AND NOT coalesce(is_blocked, false);
  v_out := v_out || E'\n' || format('%s G3 unblocking clears the removed-account marker → %s, marker %s, unblocked %s',
    CASE WHEN v_res LIKE 'ok:%' AND v_n = 0 AND v_m = 1 THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60), v_n, v_m);

  -- ── F · work permits ───────────────────────────────────────────────────────────
  DELETE FROM player_work_permits WHERE player_id IN (c_player, v_adult);
  INSERT INTO player_work_permits (player_id, country_id, type) VALUES (c_player, v_country, 'visa'), (v_adult, v_country, 'visa');
  v_res := _probe_run(c_club, format('SELECT count(*) FROM player_work_permits WHERE player_id = %L', c_player));
  v_txt := _probe_run(c_club, format('SELECT count(*) FROM player_work_permits WHERE player_id = %L', v_adult));
  v_out := v_out || E'\n' || format('%s F1 a club reads work permits: under-18 %s, adult %s (want 0, 1)',
    CASE WHEN v_res = 'ok:0' AND v_txt = 'ok:1' THEN 'PASS' ELSE 'FAIL' END, v_res, v_txt);
  v_res := _probe_run(c_player, format('SELECT count(*) FROM player_work_permits WHERE player_id = %L', c_player));
  v_out := v_out || E'\n' || format('%s F2 the under-18 still reads their own → %s', CASE WHEN v_res = 'ok:1' THEN 'PASS' ELSE 'FAIL' END, v_res);

  -- ── H · lookups signed out ─────────────────────────────────────────────────────
  v_n := 0; v_txt := '';
  FOR v_res IN
    SELECT _probe_run(NULL, q, false, 'anon') FROM unnest(ARRAY[
      format('SELECT is_blocked_pair(%L, %L)::text', c_club, c_coach),
      format('SELECT user_in_conversation(%L, %L)::text', gen_random_uuid(), c_club),
      format('SELECT club_has_applicant(%L, %L)::text', c_club, c_player),
      format('SELECT is_suggestible(%L)::text', v_adult),
      format('SELECT can_toggle_open_to_play(%L)::text', v_adult),
      'SELECT compute_product_health_score()::text',
      format('SELECT is_adult_profile(%L)::text', v_adult)]) q
  LOOP
    IF v_res ILIKE 'ERR:permission denied%' THEN v_n := v_n + 1; ELSE v_txt := v_txt || ' ' || left(v_res, 30); END IF;
  END LOOP;
  v_out := v_out || E'\n' || format('%s H1 seven lookup functions refused signed out → %s/7%s', CASE WHEN v_n = 7 THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);

  v_res := _probe_run(c_coach, format('SELECT is_blocked_pair(%L, %L)::text', c_coach, c_club));
  v_txt := _probe_run(c_coach, 'SELECT compute_product_health_score()::text');
  v_out := v_out || E'\n' || format('%s H2 a member: is_blocked_pair works, compute_product_health_score refused → %s · %s',
    CASE WHEN v_res = 'ok:false' AND v_txt ILIKE 'ERR:permission denied%' THEN 'PASS' ELSE 'FAIL' END, v_res, left(v_txt, 50));

  -- ── I · link_signup_attribution (installed builds send p_first_source) ────────
  v_res := _probe_run(c_coach, 'SELECT link_signup_attribution(p_anonymous_id => ''probe-anon'', p_first_referrer => ''https://user@www.example.com:8443/x'', p_first_source => ''google'', p_landing_path => ''/'')::text');
  v_out := v_out || E'\n' || format('%s I1 the 6-argument call still works → %s', CASE WHEN v_res LIKE 'ok:%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 80));

  -- ── K · AI quota helpers ───────────────────────────────────────────────────────
  DELETE FROM ai_opinion_quota WHERE viewer_id = c_club;
  v_res := '';
  FOR i IN 1..3 LOOP
    v_res := v_res || CASE WHEN i > 1 THEN ',' ELSE '' END || coalesce(ai_opinion_quota_take(c_club, 2)::text, 'NULL');
  END LOOP;
  PERFORM ai_opinion_quota_release(c_club);
  SELECT count INTO v_n FROM ai_opinion_quota WHERE viewer_id = c_club AND day = (now() AT TIME ZONE 'utc')::date;
  v_out := v_out || E'\n' || format('%s K1 quota take ×3 with cap 2 → %s (want 1,2,NULL); after one release count %s (want 1)',
    CASE WHEN v_res = '1,2,NULL' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);
  v_res := _probe_run(c_club, format('SELECT ai_opinion_quota_take(%L, 50)::text', c_club));
  v_out := v_out || E'\n' || format('%s K2 a member cannot call the quota function → %s', CASE WHEN v_res ILIKE 'ERR:permission denied%' THEN 'PASS' ELSE 'FAIL' END, left(v_res, 60));

  DELETE FROM ai_usage_log WHERE user_id = c_club;
  INSERT INTO ai_usage_log (user_id, function, cost_usd) VALUES (c_club, 'nl-search', 0), (c_club, 'nl-search', 0), (c_club, 'draft-message', 0), (NULL, 'alert', 0);
  v_n := ai_questions_today(c_club);
  v_out := v_out || E'\n' || format('%s K3 ai_questions_today counts Hockia AI questions only → %s (want 2)', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── L · one owner per push device ──────────────────────────────────────────────
  DELETE FROM push_subscriptions WHERE profile_id IN (c_club, c_coach);
  INSERT INTO push_subscriptions (profile_id, fcm_token, platform) VALUES (c_club, 'probe-token-1', 'ios');
  INSERT INTO push_subscriptions (profile_id, endpoint, p256dh, auth) VALUES (c_club, 'https://push.example.invalid/1', 'k', 'a');
  v_res := _probe_run(c_coach, format('INSERT INTO push_subscriptions (profile_id, fcm_token, platform) VALUES (%L, ''probe-token-1'', ''ios'') RETURNING 1', c_coach));
  SELECT count(*) FILTER (WHERE profile_id = c_club AND fcm_token = 'probe-token-1'),
         count(*) FILTER (WHERE profile_id = c_coach AND fcm_token = 'probe-token-1'),
         count(*) FILTER (WHERE profile_id = c_club AND endpoint = 'https://push.example.invalid/1')
    INTO v_n, v_m, v_k
    FROM push_subscriptions WHERE profile_id IN (c_club, c_coach);
  v_out := v_out || E'\n' || format('%s L1 another account registers the same device token → %s; old owner %s, new owner %s, unrelated web row %s (want 0,1,1)',
    CASE WHEN v_res = 'ok:1' AND v_n = 0 AND v_m = 1 AND v_k = 1 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n, v_m, v_k);

  v_res := _probe_run(c_coach, format('INSERT INTO push_subscriptions (profile_id, endpoint, p256dh, auth) VALUES (%L, ''https://push.example.invalid/1'', ''k'', ''a'') RETURNING 1', c_coach));
  SELECT count(*) INTO v_n FROM push_subscriptions WHERE endpoint = 'https://push.example.invalid/1';
  v_out := v_out || E'\n' || format('%s L2 same for a web push endpoint → %s; rows with that endpoint %s (want 1)',
    CASE WHEN v_res = 'ok:1' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);

  -- ── J · cron ───────────────────────────────────────────────────────────────────
  SELECT count(*) FILTER (WHERE jobname = 'archive_messages_daily'),
         count(*) FILTER (WHERE jobname IN ('cleanup_rate_limits_daily', 'prune_old_heartbeats_daily'))
    INTO v_n, v_m FROM cron.job;
  v_out := v_out || E'\n' || format('%s J1 archive_messages_daily gone (%s), the two clean-ups scheduled (%s)',
    CASE WHEN v_n = 0 AND v_m = 2 THEN 'PASS' ELSE 'FAIL' END, v_n, v_m);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
