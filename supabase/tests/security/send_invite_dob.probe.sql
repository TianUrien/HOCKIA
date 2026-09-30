-- Probe for 20261001200000_send_invite_requires_dob.sql and
-- 20261001210000_send_invite_no_reinvite_same_role.sql: who a club can invite to apply (D3).
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement.
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT.
-- Every case runs in a sub-transaction that is always rolled back (undo).

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  c_refused constant text := 'This person can''t be invited to this role';
  o_player uuid; o_player2 uuid; o_coach uuid;
  v_res jsonb;
  v_n int;
  v_txt text;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] invite dob · player A', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_player;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] invite dob · player B', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_player2;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'coach', '[PROBE] invite dob · coach', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_coach;
  -- A clean slate between the club and the two people (rolled back at the end).
  DELETE FROM opportunity_invites WHERE club_id = c_club AND player_id IN (c_player, c_coach);
  DELETE FROM opportunity_applications a USING opportunities o
   WHERE o.id = a.opportunity_id AND o.club_id = c_club AND a.applicant_id IN (c_player, c_coach);
  DELETE FROM user_blocks
   WHERE (blocker_id IN (c_player, c_coach) AND blocked_id = c_club) OR (blocker_id = c_club AND blocked_id IN (c_player, c_coach));
  UPDATE profiles SET created_at = least(created_at, now() - interval '30 days') WHERE id = c_club;
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL,
                      dob_required_since = NULL, is_blocked = false, onboarding_completed = true
   WHERE id = c_player;
  UPDATE profiles SET open_to_play = true WHERE id = c_player;

  -- A1 adult, open-to-play player → invited
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_player, 'Probe note');
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM opportunity_invites WHERE club_id = c_club AND player_id = c_player AND status = 'sent';
    v_line := format('%s A1 adult open player → invite_id %s, remaining_today %s (open invites=%s)',
      CASE WHEN v_res ? 'invite_id' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_res->>'invite_id', v_res->>'remaining_today', v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL A1 adult open player → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- A2 player turning 18 today → invited (boundary)
  BEGIN
    UPDATE profiles SET date_of_birth = ((timezone('utc', now()))::date - interval '18 years')::date WHERE id = c_player;
    UPDATE profiles SET open_to_play = true, frozen_minor_at = NULL WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_player, NULL);
    EXECUTE 'RESET ROLE';
    v_line := format('%s A2 player 18 today → %s', CASE WHEN v_res ? 'invite_id' THEN 'PASS' ELSE 'FAIL' END, v_res->>'invite_id');
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL A2 player 18 today → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B1 player with NO date of birth (open to play, not frozen) → refused, nothing written
  BEGIN
    UPDATE profiles SET date_of_birth = NULL, frozen_minor_at = NULL, dob_required_since = NULL WHERE id = c_player;
    UPDATE profiles SET open_to_play = true WHERE id = c_player;
    SELECT format('dob=%s open_to_play=%s', coalesce(date_of_birth::text, 'NULL'), open_to_play) INTO v_txt FROM profiles WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := send_invite(c_player, o_player, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL B1 no DOB (%s) → allowed %s', v_txt, v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      SELECT count(*) INTO v_n FROM opportunity_invites WHERE club_id = c_club AND player_id = c_player;
      v_line := format('%s B1 no DOB (%s) → "%s" (rows=%s)',
        CASE WHEN SQLERRM = c_refused AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_txt, SQLERRM, v_n);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B1 no DOB → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B2 player aged 17 → refused (same message)
  BEGIN
    UPDATE profiles SET date_of_birth = (current_date - interval '17 years')::date WHERE id = c_player;
    UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_player;
    SELECT format('open_to_play=%s', open_to_play) INTO v_txt FROM profiles WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := send_invite(c_player, o_player, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL B2 aged 17 (%s) → allowed %s', v_txt, v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      v_line := format('%s B2 aged 17 (%s) → "%s"', CASE WHEN SQLERRM = c_refused THEN 'PASS' ELSE 'FAIL' END, v_txt, SQLERRM);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B2 aged 17 → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B3 adult player NOT open to play → refused (same message)
  BEGIN
    UPDATE profiles SET open_to_play = false WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := send_invite(c_player, o_player, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL B3 not open to play → allowed %s', v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      v_line := format('%s B3 not open to play → "%s"', CASE WHEN SQLERRM = c_refused THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B3 not open to play → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C1 one open invite per player per club: a second role while the first is open → refused
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_player, NULL);
    BEGIN
      v_res := send_invite(c_player, o_player2, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL C1 second open invite → allowed %s', v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      v_line := format('%s C1 second open invite → "%s"',
        CASE WHEN SQLERRM = 'This player already has an open invite from you' THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C1 second open invite → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C2 open application to another of the club's roles → refused
  BEGIN
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o_player2, c_player, 'pending');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := send_invite(c_player, o_player, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL C2 open application elsewhere → allowed %s', v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      v_line := format('%s C2 open application elsewhere → "%s"',
        CASE WHEN SQLERRM = 'This player has already applied to one of your roles' THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C2 open application elsewhere → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C3 daily limit: 20 invites already sent in the last 24h (established club) → refused
  BEGIN
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, sent_at, expires_at)
    SELECT o_player2, c_club, c_coach, 'expired', now() - interval '1 hour', now() + interval '13 days'
      FROM generate_series(1, 20);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := send_invite(c_player, o_player, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL C3 daily limit (20) → allowed %s', v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      v_line := format('%s C3 daily limit (20) → "%s"',
        CASE WHEN SQLERRM = 'Daily invite limit reached (20 per day)' THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C3 daily limit → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C4 first-week club: 5 already sent → refused at 5
  BEGIN
    UPDATE profiles SET created_at = now() - interval '2 days' WHERE id = c_club;
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, sent_at, expires_at)
    SELECT o_player2, c_club, c_coach, 'expired', now() - interval '1 hour', now() + interval '13 days'
      FROM generate_series(1, 5);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := send_invite(c_player, o_player, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL C4 first-week limit (5) → allowed %s', v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      v_line := format('%s C4 first-week limit (5) → "%s"',
        CASE WHEN SQLERRM = 'Daily invite limit reached (5 per day)' THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C4 first-week limit → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D1 coach role: an open-to-coach coach with NO date of birth → invited (coaches are not age-gated)
  BEGIN
    UPDATE profiles SET date_of_birth = NULL, frozen_minor_at = NULL, dob_required_since = NULL WHERE id = c_coach;
    UPDATE profiles SET open_to_coach = true WHERE id = c_coach;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_coach, o_coach, NULL);
    EXECUTE 'RESET ROLE';
    v_line := format('%s D1 coach without DOB on a coach role → %s', CASE WHEN v_res ? 'invite_id' THEN 'PASS' ELSE 'FAIL' END, v_res->>'invite_id');
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D1 coach without DOB → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- F1 the player passed on this role → the same role is refused
  BEGIN
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, sent_at, expires_at, responded_at)
    VALUES (o_player, c_club, c_player, 'declined', now() - interval '2 days', now() + interval '12 days', now() - interval '1 day');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := send_invite(c_player, o_player, NULL);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL F1 re-invite to a declined role → allowed %s', v_res);
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      v_line := format('%s F1 re-invite to a declined role → "%s"',
        CASE WHEN SQLERRM = 'This player passed on this role' THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL F1 declined role → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- F2 the player passed on role A → role B of the same club is still allowed
  BEGIN
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, sent_at, expires_at, responded_at)
    VALUES (o_player, c_club, c_player, 'declined', now() - interval '2 days', now() + interval '12 days', now() - interval '1 day');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_player2, NULL);
    EXECUTE 'RESET ROLE';
    v_line := format('%s F2 other role after a decline → %s', CASE WHEN v_res ? 'invite_id' THEN 'PASS' ELSE 'FAIL' END, v_res->>'invite_id');
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL F2 other role after a decline → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- F3 control: an EXPIRED (not declined) invite on the same role doesn't block a new one
  BEGIN
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, sent_at, expires_at)
    VALUES (o_player, c_club, c_player, 'expired', now() - interval '20 days', now() - interval '6 days');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_player, NULL);
    EXECUTE 'RESET ROLE';
    v_line := format('%s F3 same role after an expired invite → %s', CASE WHEN v_res ? 'invite_id' THEN 'PASS' ELSE 'FAIL' END, v_res->>'invite_id');
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL F3 expired invite → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E1 anon cannot execute send_invite
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    v_res := send_invite(c_player, o_player, NULL);
    v_line := 'FAIL E1 anon executes send_invite → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS E1 anon executes send_invite → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E2 function shape: SECURITY DEFINER, pinned search_path, no anon/PUBLIC execute
  SELECT format('definer=%s config=%s anon=%s public=%s auth=%s', p.prosecdef, p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE'),
                coalesce(p.proacl::text LIKE '%=X/%' AND p.proacl::text ~ '(^|[{,])=X', false),
                has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    INTO v_txt
    FROM pg_proc p WHERE p.oid = 'public.send_invite(uuid, uuid, text)'::regprocedure;
  v_out := v_out || E'\n' || format('%s E2 function shape → %s',
    CASE WHEN v_txt = 'definer=t config={search_path=public} anon=f public=f auth=t' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
