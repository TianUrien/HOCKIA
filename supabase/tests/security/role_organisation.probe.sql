-- Probe for 20261004200000_role_organisation_name.sql: a role published by a
-- coach names the organisation it recruits for, never the coach, on signings
-- and in the server-written texts; a club account's roles behave as before.
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
-- Every write case runs in a sub-transaction that is always rolled back (undo).
-- A signing that is already waiting is set up the way signing_current_club.probe.sql
-- does it: sys inserts the application in that state.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (publisher, recruits)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (invited / signs)
  c_typed  constant text := '[PROBE] Typed Org';
  c_cur    constant text := '[PROBE] Coach Current Club';
  v_today  constant date := timezone('utc', now())::date;
  o_club uuid; o_coach uuid; a_club uuid; a_coach uuid; a_wait uuid;
  w_role uuid; w_role_name text; w_coach uuid; w_coach_name text;
  v_club_name text; v_coach_name text; v_club_world uuid;
  r record;
  v_res jsonb; v_n int; v_txt text; v_txt2 text; v_id uuid;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT full_name INTO v_club_name FROM profiles WHERE id = c_club;
  SELECT full_name INTO v_coach_name FROM profiles WHERE id = c_coach;
  SELECT id, club_name INTO w_role, w_role_name FROM world_clubs ORDER BY created_at, id LIMIT 1;
  SELECT id, club_name INTO w_coach, w_coach_name FROM world_clubs WHERE id <> w_role ORDER BY created_at, id LIMIT 1;
  -- Today's world club rule for a club account, computed the way the previous body did.
  SELECT coalesce((SELECT CASE WHEN count(*) = 1 THEN (array_agg(w.id))[1] END FROM world_clubs w WHERE w.claimed_profile_id = c_club),
                  (SELECT current_world_club_id FROM profiles WHERE id = c_club)) INTO v_club_world;

  -- A clean slate between the publishers and the player (rolled back at the end).
  DELETE FROM opportunity_invites WHERE club_id IN (c_club, c_coach) AND player_id = c_player;
  DELETE FROM opportunity_applications a USING opportunities o
   WHERE o.id = a.opportunity_id AND o.club_id IN (c_club, c_coach) AND a.applicant_id = c_player;
  DELETE FROM user_blocks
   WHERE (blocker_id = c_player AND blocked_id IN (c_club, c_coach)) OR (blocker_id IN (c_club, c_coach) AND blocked_id = c_player);
  UPDATE profiles SET created_at = least(created_at, now() - interval '30 days') WHERE id = c_club;
  UPDATE profiles SET created_at = least(created_at, now() - interval '30 days'), coach_recruits_for_team = true,
                      current_club = NULL, current_world_club_id = NULL
   WHERE id = c_coach;
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL,
                      dob_required_since = NULL, is_blocked = false, onboarding_completed = true
   WHERE id = c_player;
  UPDATE profiles SET open_to_play = true WHERE id = c_player;

  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] organisation · club role', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o_club;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_coach, 'player', '[PROBE] organisation · coach role', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o_coach;
  UPDATE opportunities SET organization_name = NULL, world_club_id = NULL WHERE id IN (o_club, o_coach);

  -- ── A · club account: as before ────────────────────────────────────────────────
  SELECT * INTO r FROM role_organisation(o_club);
  v_out := v_out || E'\n' || format('%s A1 club role, nothing typed → name "%s" (account "%s"), world %s',
    CASE WHEN r.name IS NOT DISTINCT FROM v_club_name AND r.world_club_id IS NOT DISTINCT FROM v_club_world THEN 'PASS' ELSE 'FAIL' END,
    r.name, v_club_name, coalesce(r.world_club_id::text, 'NULL'));

  UPDATE opportunities SET organization_name = c_typed, world_club_id = w_role WHERE id = o_club;
  SELECT * INTO r FROM role_organisation(o_club);
  v_out := v_out || E'\n' || format('%s A2 club role, organisation typed + role world club → name "%s", world is the role''s=%s',
    CASE WHEN r.name = c_typed AND r.world_club_id = w_role THEN 'PASS' ELSE 'FAIL' END, r.name, r.world_club_id = w_role);
  UPDATE opportunities SET organization_name = NULL, world_club_id = NULL WHERE id = o_club;

  -- ── B · coach: the resolution order, never the coach's name ────────────────────
  SELECT * INTO r FROM role_organisation(o_coach);
  v_out := v_out || E'\n' || format('%s B1 coach role, nothing anywhere → name %s, world %s',
    CASE WHEN r.name IS NULL AND r.world_club_id IS NULL THEN 'PASS' ELSE 'FAIL' END,
    coalesce('"' || r.name || '"', 'NULL'), coalesce(r.world_club_id::text, 'NULL'));

  UPDATE profiles SET current_club = c_cur WHERE id = c_coach;
  SELECT * INTO r FROM role_organisation(o_coach);
  v_out := v_out || E'\n' || format('%s B2 coach with only a typed current club → name "%s", world %s',
    CASE WHEN r.name = c_cur AND r.world_club_id IS NULL THEN 'PASS' ELSE 'FAIL' END, r.name, coalesce(r.world_club_id::text, 'NULL'));

  UPDATE profiles SET current_world_club_id = w_coach WHERE id = c_coach;
  SELECT * INTO r FROM role_organisation(o_coach);
  v_out := v_out || E'\n' || format('%s B3 coach with a current world club → name "%s" (world club "%s"), world is the coach''s=%s',
    CASE WHEN r.name = w_coach_name AND r.world_club_id = w_coach THEN 'PASS' ELSE 'FAIL' END, r.name, w_coach_name, r.world_club_id = w_coach);

  UPDATE opportunities SET world_club_id = w_role WHERE id = o_coach;
  SELECT * INTO r FROM role_organisation(o_coach);
  v_out := v_out || E'\n' || format('%s B4 coach role with its own world club → name "%s" (world club "%s"), world is the role''s=%s',
    CASE WHEN r.name = w_role_name AND r.world_club_id = w_role THEN 'PASS' ELSE 'FAIL' END, r.name, w_role_name, r.world_club_id = w_role);

  UPDATE opportunities SET organization_name = c_typed WHERE id = o_coach;
  SELECT * INTO r FROM role_organisation(o_coach);
  v_out := v_out || E'\n' || format('%s B5 coach role with a typed organisation → name "%s", world is the role''s=%s',
    CASE WHEN r.name = c_typed AND r.world_club_id = w_role THEN 'PASS' ELSE 'FAIL' END, r.name, r.world_club_id = w_role);

  UPDATE opportunities SET organization_name = '   ' WHERE id = o_coach;
  SELECT * INTO r FROM role_organisation(o_coach);
  v_out := v_out || E'\n' || format('%s B6 blank typed organisation is skipped → name "%s"',
    CASE WHEN r.name = w_role_name THEN 'PASS' ELSE 'FAIL' END, r.name);

  SELECT count(*) INTO v_n FROM role_organisation(gen_random_uuid());
  v_out := v_out || E'\n' || format('%s B7 unknown role → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- Back to "coach with nothing" for the refusals.
  UPDATE opportunities SET organization_name = NULL, world_club_id = NULL WHERE id = o_coach;
  UPDATE profiles SET current_club = NULL, current_world_club_id = NULL WHERE id = c_coach;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
  VALUES (o_coach, c_player, 'shortlisted') RETURNING id INTO a_coach;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
  VALUES (o_club, c_player, 'shortlisted') RETURNING id INTO a_club;

  -- ── C · signing refusals when a coach's role has no organisation ───────────────
  -- C1 the coach marks the signing → refused, nothing changes
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := mark_signed(a_coach, false);
      EXECUTE 'RESET ROLE';
      v_line := format('FAIL C1 coach, no organisation, mark_signed → allowed %s', v_res);
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_txt2 = PG_EXCEPTION_DETAIL;
      v_txt := SQLERRM;
      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claims', '', true);
      SELECT status::text INTO v_line FROM opportunity_applications WHERE id = a_coach;
      v_line := format('%s C1 coach, no organisation, mark_signed → "%s" (detail %s, status stays %s)',
        CASE WHEN v_txt = 'Add your club to your profile to mark a signing' AND v_txt2 = 'club_missing' AND v_line = 'shortlisted' THEN 'PASS' ELSE 'FAIL' END,
        v_txt, v_txt2, v_line);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C1 coach, no organisation, mark_signed → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C2 a signing already waiting on such a role (sys puts it there) → the player's confirm is refused, no career entry
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    DELETE FROM opportunity_applications WHERE id = a_coach;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signing_requested_at, signing_close_role)
    VALUES (o_coach, c_player, 'signed_pending_confirmation', timezone('utc', now()), false) RETURNING id INTO a_wait;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := confirm_signing(a_wait, false);
      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claims', '', true);
      v_line := format('FAIL C2 coach, no organisation, confirm_signing → allowed, career club "%s"',
        (SELECT club_name FROM career_history WHERE application_id = a_wait));
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_txt2 = PG_EXCEPTION_DETAIL;
      v_txt := SQLERRM;
      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claims', '', true);
      SELECT count(*) INTO v_n FROM career_history WHERE application_id = a_wait;
      v_line := format('%s C2 coach, no organisation, confirm_signing → "%s" (detail %s, career rows=%s, status %s)',
        CASE WHEN v_txt = 'This signing can''t be confirmed yet' AND v_txt2 = 'club_missing' AND v_n = 0
              AND (SELECT status::text FROM opportunity_applications WHERE id = a_wait) = 'signed_pending_confirmation' THEN 'PASS' ELSE 'FAIL' END,
        v_txt, v_txt2, v_n, (SELECT status::text FROM opportunity_applications WHERE id = a_wait));
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C2 coach, no organisation, confirm_signing → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- ── D · signings that go through ───────────────────────────────────────────────
  -- D1 coach with only a typed current club: mark + confirm → career entry names that club, never the coach
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE profiles SET current_club = c_cur WHERE id = c_coach;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := mark_signed(a_coach, false);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT n.metadata ->> 'title' INTO v_txt2 FROM profile_notifications n
     WHERE n.recipient_profile_id = c_player AND n.metadata ->> 'event' = 'signing_marked' AND n.source_entity_id = a_coach
     ORDER BY n.created_at DESC LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := confirm_signing(a_coach, false);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT club_name INTO v_txt FROM career_history WHERE id = (v_res ->> 'career_entry_id')::uuid;
    SELECT count(*) INTO v_n FROM club_members WHERE club_profile_id = c_coach AND member_profile_id = c_player;
    v_line := format('%s D1 coach with a typed current club → career club "%s", notification "%s", squad rows for the coach=%s',
      CASE WHEN v_txt = c_cur AND v_txt IS DISTINCT FROM v_coach_name AND v_txt2 = 'Confirm your signing with ' || c_cur AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END,
      v_txt, v_txt2, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D1 coach with a typed current club → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D2 coach role with a world club: confirm → career entry names the world club and links it
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE opportunities SET world_club_id = w_role WHERE id = o_coach;
    DELETE FROM opportunity_applications WHERE id = a_coach;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signing_requested_at, signing_close_role)
    VALUES (o_coach, c_player, 'signed_pending_confirmation', timezone('utc', now()), false) RETURNING id INTO a_wait;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := confirm_signing(a_wait, false);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT club_name, world_club_id INTO r FROM career_history WHERE id = (v_res ->> 'career_entry_id')::uuid;
    v_line := format('%s D2 coach role with a world club → career club "%s", linked to the role''s world club=%s, player current club "%s"',
      CASE WHEN r.club_name = w_role_name AND r.world_club_id = w_role
            AND (SELECT current_club FROM profiles WHERE id = c_player) = w_role_name THEN 'PASS' ELSE 'FAIL' END,
      r.club_name, r.world_club_id = w_role, (SELECT current_club FROM profiles WHERE id = c_player));
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D2 coach role with a world club → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D3 club account: mark + confirm → career entry names the account, squad row added (as before)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := mark_signed(a_club, false);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT n.metadata ->> 'title' INTO v_txt2 FROM profile_notifications n
     WHERE n.recipient_profile_id = c_player AND n.metadata ->> 'event' = 'signing_marked' AND n.source_entity_id = a_club
     ORDER BY n.created_at DESC LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := confirm_signing(a_club, false);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT club_name, world_club_id INTO r FROM career_history WHERE id = (v_res ->> 'career_entry_id')::uuid;
    SELECT count(*) INTO v_n FROM club_members WHERE club_profile_id = c_club AND member_profile_id = c_player AND status = 'active';
    v_line := format('%s D3 club account → career club "%s", world as before=%s, notification "%s", squad rows=%s',
      CASE WHEN r.club_name = v_club_name AND r.world_club_id IS NOT DISTINCT FROM v_club_world
            AND v_txt2 = 'Confirm your signing with ' || v_club_name AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END,
      r.club_name, r.world_club_id IS NOT DISTINCT FROM v_club_world, v_txt2, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D3 club account → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- ── E · server-written texts ───────────────────────────────────────────────────
  -- The player has no application on these roles for the invite cases.
  -- E1 coach's invite, organisation typed on the role → the card and the notification name it
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    DELETE FROM opportunity_applications WHERE id IN (a_coach, a_club);
    UPDATE opportunities SET organization_name = c_typed WHERE id = o_coach;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_coach, NULL);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT content INTO v_txt FROM messages WHERE id = (v_res ->> 'message_id')::uuid;
    SELECT n.metadata ->> 'club_name' INTO v_txt2 FROM profile_notifications n
     WHERE n.recipient_profile_id = c_player AND n.metadata ->> 'event' = 'invite_received'
       AND n.source_entity_id = (v_res ->> 'invite_id')::uuid
     ORDER BY n.created_at DESC LIMIT 1;
    v_line := format('%s E1 coach invite, organisation typed → card "%s", club_name "%s"',
      CASE WHEN v_txt LIKE c_typed || ' invited you to apply for %' AND v_txt2 = c_typed THEN 'PASS' ELSE 'FAIL' END,
      split_part(v_txt, E'\n', 1), v_txt2);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL E1 coach invite, organisation typed → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E2 coach's invite with no organisation anywhere → still sent, names the coach (informational text only)
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    DELETE FROM opportunity_applications WHERE id IN (a_coach, a_club);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_coach, NULL);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT content INTO v_txt FROM messages WHERE id = (v_res ->> 'message_id')::uuid;
    v_line := format('%s E2 coach invite, no organisation → sent, card "%s"',
      CASE WHEN v_res ? 'invite_id' AND v_txt LIKE v_coach_name || ' invited you to apply for %' THEN 'PASS' ELSE 'FAIL' END,
      split_part(v_txt, E'\n', 1));
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL E2 coach invite, no organisation → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E3 club account's invite → names the account (as before), even with an organisation typed on the role
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    DELETE FROM opportunity_applications WHERE id IN (a_coach, a_club);
    UPDATE opportunities SET organization_name = c_typed WHERE id = o_club;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o_club, NULL);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT content INTO v_txt FROM messages WHERE id = (v_res ->> 'message_id')::uuid;
    v_line := format('%s E3 club invite → card "%s"',
      CASE WHEN v_txt LIKE v_club_name || ' invited you to apply for %' THEN 'PASS' ELSE 'FAIL' END, split_part(v_txt, E'\n', 1));
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL E3 club invite → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E4 coach's offer then withdrawal, role world club → both cards name the world club
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE opportunities SET world_club_id = w_role WHERE id = o_coach;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := make_offer(a_coach, v_today + 7);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT content INTO v_txt FROM messages WHERE id = (v_res ->> 'message_id')::uuid;
    v_id := (v_res ->> 'offer_id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := withdraw_offer(v_id);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT m.content INTO v_txt2 FROM messages m
     WHERE m.sender_id = c_coach AND m.metadata ->> 'event' = 'offer_withdrawn' AND m.metadata ->> 'offer_id' = v_id::text
     ORDER BY m.sent_at DESC LIMIT 1;
    v_line := format('%s E4 coach offer + withdrawal, role world club → "%s" / "%s"',
      CASE WHEN v_txt LIKE w_role_name || ' sent you an offer for %' AND v_txt2 LIKE w_role_name || ' withdrew its offer for %' THEN 'PASS' ELSE 'FAIL' END,
      v_txt, v_txt2);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL E4 coach offer + withdrawal → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E5 coach's role is filled → the waiting applicant's notification names the organisation
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE opportunities SET organization_name = c_typed WHERE id = o_coach;
    SELECT _fill_waiting_applications(o_coach) INTO v_n;
    SELECT n.metadata ->> 'club_name' INTO v_txt FROM profile_notifications n
     WHERE n.recipient_profile_id = c_player AND n.metadata ->> 'status' = 'filled' AND n.source_entity_id = a_coach
     ORDER BY n.created_at DESC LIMIT 1;
    v_line := format('%s E5 coach role filled → %s application(s), club_name "%s"',
      CASE WHEN v_n = 1 AND v_txt = c_typed THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL E5 coach role filled → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- ── F · the helper is not callable by clients ──────────────────────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM * FROM role_organisation(o_coach);
    v_line := 'FAIL F1 anon executes role_organisation → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F1 anon executes role_organisation → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM * FROM role_organisation(o_coach);
    v_line := 'FAIL F2 a player executes role_organisation → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F2 a player executes role_organisation → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM * FROM role_organisation(o_coach);
    v_line := 'FAIL F3 the publishing coach executes role_organisation → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F3 the publishing coach executes role_organisation → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
