-- Probe for Track C groundwork (migrations 20260928100000 … 20260928130000):
-- invites, offers, signings, the tightened client-write guards and recruiter-only fit.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migrations. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement (fixture roles,
-- invites, offers, messages, notifications, queued webhooks — everything).
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated + request.jwt.claims,
-- exactly like PostgREST does for a signed-in user. "sys" steps run as the database
-- owner with no JWT (scheduler / fixture setup).
--
-- Cases marked (undo) run in a sub-transaction that is always rolled back, so they
-- can bend fixture data (age, open to play, account age) without affecting later cases.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (recruits)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (adult, open to play)
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid;
  inv_a1 uuid; inv_a3 uuid; inv_a6 uuid;
  app_b uuid; app_c uuid; app_d uuid; app_e uuid; app_f uuid;
  off_1 uuid; off_2 uuid; off_3 uuid; off_4 uuid;
  msg_invite uuid; msg_offer uuid;
  v_conv uuid;
  v_res jsonb;
  v_n int; v_m int;
  v_txt text; v_txt2 text;
  v_bool boolean;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] Track C role 1', 'Dublin', 'Ireland', 'open') RETURNING id INTO o1;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] Track C role 2', 'Dublin', 'Ireland', 'open') RETURNING id INTO o2;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_coach, 'player', '[PROBE] Track C coach role', 'Cork', 'Ireland', 'open') RETURNING id INTO o3;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] Track C role 4', 'Dublin', 'Ireland', 'open') RETURNING id INTO o4;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] Track C role 5', 'Dublin', 'Ireland', 'open') RETURNING id INTO o5;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] Track C role 6', 'Dublin', 'Ireland', 'open') RETURNING id INTO o6;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] Track C role 7', 'Dublin', 'Ireland', 'open') RETURNING id INTO o7;
  UPDATE profiles SET open_to_play = true WHERE id = c_player;
  UPDATE profiles SET coach_recruits_for_team = true WHERE id = c_coach;
  -- Start the player outside the club's pipeline (staging QA data may hold a live
  -- application to one of the club's open roles, which rightly blocks invites).
  UPDATE opportunity_applications a SET status = 'no_response'
   WHERE a.applicant_id = c_player
     AND a.status::text IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted', 'signed_pending_confirmation')
     AND EXISTS (SELECT 1 FROM opportunities o WHERE o.id = a.opportunity_id AND o.club_id IN (c_club, c_coach));

  -- ════ D · eligibility, limits, grants, sweeps (all undo) ═══════════════════════

  -- D0 baseline: club can invite the player
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, 'Baseline note');
    v_line := 'PASS D0 club invites an adult open player → ' || (v_res->>'remaining_today') || ' left today';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D0 club invites an adult open player → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D1 under-18 by DOB is refused (freeze cleared so only is_minor applies)
  BEGIN
    UPDATE profiles SET date_of_birth = (now() - interval '16 years')::date WHERE id = c_player;
    UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'FAIL D1 invite to an under-18 → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE '%can''t be invited%' THEN 'PASS' ELSE 'FAIL' END || ' D1 invite to an under-18 → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D2 unknown DOB is allowed (founder answer 2026-09-26)
  BEGIN
    UPDATE profiles SET date_of_birth = NULL, dob_required_since = NULL WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'PASS D2 invite to a player with no DOB → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D2 invite to a player with no DOB → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D2b a frozen (minor) account is refused even with an adult DOB on file
  BEGIN
    UPDATE profiles SET frozen_minor_at = now() WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'FAIL D2b invite to a frozen account → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE '%can''t be invited%' THEN 'PASS' ELSE 'FAIL' END || ' D2b invite to a frozen account → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D3 not open to play is refused
  BEGIN
    UPDATE profiles SET open_to_play = false WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'FAIL D3 invite to a player not open to play → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE '%can''t be invited%' THEN 'PASS' ELSE 'FAIL' END || ' D3 invite to a player not open to play → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D4 a coach who doesn't recruit can't invite, even to a role they posted
  BEGIN
    UPDATE profiles SET coach_recruits_for_team = false WHERE id = c_coach;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o3, NULL);
    v_line := 'FAIL D4 non-recruiting coach invites → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Only clubs and coaches who recruit%' THEN 'PASS' ELSE 'FAIL' END || ' D4 non-recruiting coach invites → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D5 daily limit: 20 in 24 h for an established account
  BEGIN
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, expires_at, sent_at)
    SELECT o1, c_club, c_player, 'declined', now() + interval '14 days', now() - interval '1 hour'
      FROM generate_series(1, 20);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'FAIL D5 21st invite in 24 h → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Daily invite limit%' THEN 'PASS' ELSE 'FAIL' END || ' D5 21st invite in 24 h → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D6 daily limit: 19 sent → the 20th is allowed
  BEGIN
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, expires_at, sent_at)
    SELECT o1, c_club, c_player, 'declined', now() + interval '14 days', now() - interval '1 hour'
      FROM generate_series(1, 19);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'PASS D6 20th invite in 24 h → allowed, ' || (v_res->>'remaining_today') || ' left';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D6 20th invite in 24 h → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D7 first 7 days: 5 per day
  BEGIN
    UPDATE profiles SET created_at = now() - interval '2 days' WHERE id = c_club;
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, expires_at, sent_at)
    SELECT o1, c_club, c_player, 'declined', now() + interval '14 days', now() - interval '1 hour'
      FROM generate_series(1, 5);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'FAIL D7 new account 6th invite → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Daily invite limit%' THEN 'PASS' ELSE 'FAIL' END || ' D7 new account 6th invite → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D8 first 7 days: the 5th is allowed
  BEGIN
    UPDATE profiles SET created_at = now() - interval '2 days' WHERE id = c_club;
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, expires_at, sent_at)
    SELECT o1, c_club, c_player, 'declined', now() + interval '14 days', now() - interval '1 hour'
      FROM generate_series(1, 4);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'PASS D8 new account 5th invite → allowed, ' || (v_res->>'remaining_today') || ' left';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D8 new account 5th invite → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D9 anon can't call the functions
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    v_res := send_invite(c_player, o7, NULL);
    v_line := 'FAIL D9 anon calls send_invite → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'permission denied%' THEN 'PASS' ELSE 'FAIL' END || ' D9 anon calls send_invite → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D10 signed-in users can't call the sweep or is_minor
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := expire_offers_and_invites();
    v_line := 'FAIL D10a member calls expire_offers_and_invites → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'permission denied%' THEN 'PASS' ELSE 'FAIL' END || ' D10a member calls expire_offers_and_invites → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_bool := is_minor(c_player);
    v_line := 'FAIL D10b member calls is_minor → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'permission denied%' THEN 'PASS' ELSE 'FAIL' END || ' D10b member calls is_minor → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D11 an expired invite can't be answered; the sweep marks it expired
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE opportunity_invites SET expires_at = now() - interval '1 minute' WHERE id = (v_res->>'invite_id')::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM respond_invite((v_res->>'invite_id')::uuid, 'apply', NULL);
      v_txt := 'answered';
    EXCEPTION WHEN others THEN
      v_txt := 'refused (' || SQLERRM || ')';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM expire_offers_and_invites();
    SELECT status INTO v_txt2 FROM opportunity_invites WHERE id = (v_res->>'invite_id')::uuid;
    v_line := format('%s D11 answer an expired invite → %s; after sweep status=%s',
                     CASE WHEN v_txt LIKE 'refused%' AND v_txt2 = 'expired' THEN 'PASS' ELSE 'FAIL' END, v_txt, v_txt2);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D11 invite expiry → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D12 an invite expires when its role closes (club closes it from the UI)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o7, NULL);
    UPDATE opportunities SET status = 'closed', closed_reason = 'withdrawn' WHERE id = o7;
    EXECUTE 'RESET ROLE';
    SELECT status INTO v_txt FROM opportunity_invites WHERE id = (v_res->>'invite_id')::uuid;
    v_line := format('%s D12 role closed → invite %s', CASE WHEN v_txt = 'expired' THEN 'PASS' ELSE 'FAIL' END, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D12 role closed → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D13 offer past open_until: can't be accepted; the sweep expires it, the application
  --     goes back to shortlisted and the club is told
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
    VALUES (o7, c_player, 'shortlisted') RETURNING id INTO app_d;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := make_offer(app_d, (now() + interval '5 days')::date);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE opportunity_offers SET open_until = (now() - interval '1 day')::date WHERE id = (v_res->>'offer_id')::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM respond_offer((v_res->>'offer_id')::uuid, true, NULL);
      v_txt := 'accepted';
    EXCEPTION WHEN others THEN
      v_txt := 'refused (' || SQLERRM || ')';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM expire_offers_and_invites();
    SELECT f.status || '/' || a.status::text INTO v_txt2
      FROM opportunity_offers f JOIN opportunity_applications a ON a.id = f.application_id
     WHERE f.id = (v_res->>'offer_id')::uuid;
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_club AND kind = 'recruiting_update' AND source_entity_id = app_d
       AND metadata->>'event' = 'offer_expired';
    v_line := format('%s D13 accept an expired offer → %s; after sweep offer/app=%s; club told=%s',
                     CASE WHEN v_txt LIKE 'refused%' AND v_txt2 = 'expired/shortlisted' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END,
                     v_txt, v_txt2, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D13 offer expiry → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D14 signing not confirmed in 14 days: can't be confirmed; the sweep undoes it
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
    VALUES (o7, c_player, 'shortlisted') RETURNING id INTO app_d;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM mark_signed(app_d, true);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE opportunity_applications SET signing_requested_at = now() - interval '15 days' WHERE id = app_d;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM confirm_signing(app_d, true);
      v_txt := 'confirmed';
    EXCEPTION WHEN others THEN
      v_txt := 'refused (' || SQLERRM || ')';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM expire_offers_and_invites();
    SELECT status::text INTO v_txt2 FROM opportunity_applications WHERE id = app_d;
    v_line := format('%s D14 confirm after 14 days → %s; after sweep status=%s',
                     CASE WHEN v_txt LIKE 'refused%' AND v_txt2 = 'shortlisted' THEN 'PASS' ELSE 'FAIL' END, v_txt, v_txt2);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D14 signing expiry → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D15 fit only for recruiters (compute_club_fit)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM compute_club_fit(c_club, c_player, NULL, NULL, NULL);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_m FROM compute_club_fit(c_coach, c_player, NULL, NULL, NULL);
    EXECUTE 'RESET ROLE';
    UPDATE profiles SET coach_recruits_for_team = false WHERE id = c_coach;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_txt FROM compute_club_fit(c_coach, c_player, NULL, NULL, NULL);
    EXECUTE 'RESET ROLE';
    v_line := format('%s D15 fit rows: club=%s recruiting coach=%s candidate coach=%s',
                     CASE WHEN v_n = 1 AND v_m = 1 AND v_txt = '0' THEN 'PASS' ELSE 'FAIL' END, v_n, v_m, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D15 fit gate → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- D16 plain chat still notifies as before; a client can't send a recruiting card
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    v_conv := _recruiting_conversation(c_club, c_player, 'Direct');
    DELETE FROM profile_notifications WHERE recipient_profile_id = c_club AND kind = 'message_received' AND source_entity_id = v_conv;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO messages (conversation_id, sender_id, content) VALUES (v_conv, c_player, 'Probe hello');
    BEGIN
      INSERT INTO messages (conversation_id, sender_id, content, metadata)
      VALUES (v_conv, c_player, 'fake', jsonb_build_object('type', 'opportunity_offer', 'offer_id', gen_random_uuid()));
      v_txt := 'forged card accepted';
    EXCEPTION WHEN others THEN
      v_txt := 'forged card refused (' || SQLERRM || ')';
    END;
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_club AND kind = 'message_received' AND source_entity_id = v_conv;
    v_line := format('%s D16 plain message notifies (%s); %s',
                     CASE WHEN v_n = 1 AND v_txt LIKE 'forged card refused%' THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D16 chat → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ════ A · invites ══════════════════════════════════════════════════════════════

  -- A1 club invites player to role 1
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o1, 'We like your video.');
    EXECUTE 'RESET ROLE';
    inv_a1 := (v_res->>'invite_id')::uuid; msg_invite := (v_res->>'message_id')::uuid; v_conv := (v_res->>'conversation_id')::uuid;
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_player AND kind = 'recruiting_update' AND source_entity_id = inv_a1;
    SELECT count(*) INTO v_m FROM profile_notifications
     WHERE recipient_profile_id = c_player AND kind = 'message_received' AND metadata->>'last_message_id' = msg_invite::text;
    SELECT char_length(content) || ' chars, type=' || (metadata->>'type') INTO v_txt FROM messages WHERE id = msg_invite;
    v_line := format('%s A1 club invites → card (%s), recruiting_update=%s, duplicate message bell=%s',
                     CASE WHEN v_n = 1 AND v_m = 0 AND v_txt LIKE '%opportunity_invite' THEN 'PASS' ELSE 'FAIL' END, v_txt, v_n, v_m);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL A1 club invites → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- A2 one open invite per player per club
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o2, NULL);
    v_line := 'FAIL A2 second open invite from the same club → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE '%already has an open invite%' THEN 'PASS' ELSE 'FAIL' END || ' A2 second open invite from the same club → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- A3 another publisher (recruiting coach) may invite the same player
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o3, NULL);
    EXECUTE 'RESET ROLE';
    inv_a3 := (v_res->>'invite_id')::uuid;
    v_line := 'PASS A3 recruiting coach invites to own role → allowed';
  EXCEPTION WHEN others THEN
    v_line := 'FAIL A3 recruiting coach invites to own role → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- A4 cross-club: coach can't invite to the club's role
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o4, NULL);
    v_line := 'FAIL A4 invite to someone else''s role → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'You can only invite%' THEN 'PASS' ELSE 'FAIL' END || ' A4 invite to someone else''s role → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- A5 cross-party: the club can't answer the player's invite
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := respond_invite(inv_a1, 'apply', NULL);
    v_line := 'FAIL A5 non-invitee answers the invite → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Invite not found' THEN 'PASS' ELSE 'FAIL' END || ' A5 non-invitee answers the invite → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- A6 player declines; the club is told; the club may then invite to another role
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := respond_invite(inv_a1, 'decline', NULL);
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_club AND kind = 'recruiting_update' AND source_entity_id = inv_a1
       AND metadata->>'event' = 'invite_declined';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o2, NULL);
    EXECUTE 'RESET ROLE';
    inv_a6 := (v_res->>'invite_id')::uuid;
    v_line := format('%s A6 decline → club told=%s; new invite to role 2 allowed', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL A6 decline then re-invite → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- A7 player applies from the invite → normal pending application tagged with the invite
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := respond_invite(inv_a6, 'apply', 'Keen to come.');
    EXECUTE 'RESET ROLE';
    app_b := (v_res->>'application_id')::uuid;
    SELECT a.status::text || '/' || coalesce((a.invite_id = inv_a6)::text, 'null') || '/' || i.status
      INTO v_txt
      FROM opportunity_applications a JOIN opportunity_invites i ON i.id = inv_a6
     WHERE a.id = app_b;
    SELECT count(*) INTO v_n FROM messages WHERE metadata->>'event' = 'invite_applied' AND metadata->>'invite_id' = inv_a6::text;
    v_line := format('%s A7 apply from invite → app/linked/invite=%s, card=%s',
                     CASE WHEN v_txt = 'pending/true/applied' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_txt, v_n);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL A7 apply from invite → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- A8 a player already in the club's pipeline can't be invited to another of its roles
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := send_invite(c_player, o4, NULL);
    v_line := 'FAIL A8 invite a player with a live application → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE '%already applied to one of your roles' THEN 'PASS' ELSE 'FAIL' END || ' A8 invite a player with a live application → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ════ B · offer → signing ═════════════════════════════════════════════════════

  -- B1 no offer before shortlist
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := make_offer(app_b, (now() + interval '10 days')::date);
    v_line := 'FAIL B1 offer to a pending application → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Offers can be made to shortlisted%' THEN 'PASS' ELSE 'FAIL' END || ' B1 offer to a pending application → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B2 existing flow: club shortlists directly
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET status = 'shortlisted' WHERE id = app_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    v_line := format('%s B2 club shortlists directly (existing flow) → %s row', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B2 club shortlists directly → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B3 client can't set a new status directly
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET status = 'signed' WHERE id = app_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('FAIL B3 club sets status signed directly → %s row', v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Clubs can set pending%' THEN 'PASS' ELSE 'FAIL' END || ' B3 club sets status signed directly → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B4 cross-club: coach can't offer on the club's application
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := make_offer(app_b, (now() + interval '10 days')::date);
    v_line := 'FAIL B4 offer on someone else''s application → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Application not found' THEN 'PASS' ELSE 'FAIL' END || ' B4 offer on someone else''s application → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B5 club makes an offer (v1); no terms in the card text
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := make_offer(app_b, (now() + interval '10 days')::date, NULL, '1 season', 'EUR 900 / month',
                        ARRAY['housing', 'job'], 'Welcome!');
    EXECUTE 'RESET ROLE';
    off_1 := (v_res->>'offer_id')::uuid; msg_offer := (v_res->>'message_id')::uuid;
    SELECT a.status::text INTO v_txt FROM opportunity_applications a WHERE a.id = app_b;
    SELECT (content LIKE '%900%' OR metadata::text LIKE '%900%') INTO v_bool FROM messages WHERE id = msg_offer;
    v_line := format('%s B5 offer v1 → app=%s, terms in chat=%s', CASE WHEN v_txt = 'offered' AND NOT v_bool THEN 'PASS' ELSE 'FAIL' END, v_txt, v_bool);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B5 offer v1 → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B6 client can't move an offered application back to the review states
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET status = 'rejected' WHERE id = app_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('FAIL B6 club rejects an offered application directly → %s row', v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'This application can only be changed%' THEN 'PASS' ELSE 'FAIL' END || ' B6 club rejects an offered application directly → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B7 no direct writes on the new tables
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_offers SET pay = 'EUR 1' WHERE id = off_1;
    v_line := 'FAIL B7a club edits an offer row directly → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'permission denied%' THEN 'PASS' ELSE 'FAIL' END || ' B7a club edits an offer row directly → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_offers SET status = 'accepted' WHERE id = off_1;
    v_line := 'FAIL B7b player accepts by editing the row → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'permission denied%' THEN 'PASS' ELSE 'FAIL' END || ' B7b player accepts by editing the row → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, expires_at) VALUES (o4, c_club, c_player, now() + interval '1 day');
    v_line := 'FAIL B7c club inserts an invite directly → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'permission denied%' THEN 'PASS' ELSE 'FAIL' END || ' B7c club inserts an invite directly → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET trial = true WHERE id = app_b;
    v_line := 'FAIL B7d club sets trial directly → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'permission denied%' THEN 'PASS' ELSE 'FAIL' END || ' B7d club sets trial directly → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B8 edit = new version; the old one is superseded; one live offer
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := make_offer(app_b, (now() + interval '12 days')::date, NULL, '1 season', 'EUR 1000 / month', NULL, NULL);
    EXECUTE 'RESET ROLE';
    off_2 := (v_res->>'offer_id')::uuid;
    SELECT string_agg(version || ':' || status, ',' ORDER BY version) INTO v_txt FROM opportunity_offers WHERE application_id = app_b;
    SELECT content INTO v_txt2 FROM messages WHERE id = (v_res->>'message_id')::uuid;
    v_line := format('%s B8 edit offer → versions %s; card "%s"',
                     CASE WHEN v_txt = '1:superseded,2:live' AND v_txt2 LIKE '%updated its offer%' THEN 'PASS' ELSE 'FAIL' END, v_txt, left(v_txt2, 60));
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B8 edit offer → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B9 terms visible only to that club and that player
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunity_offers WHERE application_id = app_b;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_m FROM opportunity_offers WHERE application_id = app_b;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_txt FROM opportunity_offers WHERE application_id = app_b;
    EXECUTE 'RESET ROLE';
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      EXECUTE 'SET LOCAL ROLE anon';
      PERFORM count(*) FROM opportunity_offers;
      v_txt2 := 'anon can read';
    EXCEPTION WHEN others THEN
      v_txt2 := 'anon refused';
    END;
    EXECUTE 'RESET ROLE';
    v_line := format('%s B9 offer rows visible: other recruiter=%s player=%s club=%s, %s',
                     CASE WHEN v_n = 0 AND v_m = 2 AND v_txt = '2' AND v_txt2 = 'anon refused' THEN 'PASS' ELSE 'FAIL' END,
                     v_n, v_m, v_txt, v_txt2);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B9 offer visibility → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B10 club withdraws before the answer → shortlisted, player told
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := withdraw_offer(off_2);
    EXECUTE 'RESET ROLE';
    SELECT a.status::text || '/' || f.status INTO v_txt
      FROM opportunity_applications a JOIN opportunity_offers f ON f.id = off_2 WHERE a.id = app_b;
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_player AND kind = 'recruiting_update' AND source_entity_id = app_b
       AND metadata->>'event' = 'offer_withdrawn';
    v_line := format('%s B10 withdraw offer → app/offer=%s, player told=%s',
                     CASE WHEN v_txt = 'shortlisted/withdrawn' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_txt, v_n);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B10 withdraw offer → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B11 a withdrawn offer can't be accepted
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := respond_offer(off_2, true, NULL);
    v_line := 'FAIL B11 accept a withdrawn offer → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'This offer is no longer open' THEN 'PASS' ELSE 'FAIL' END || ' B11 accept a withdrawn offer → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B12 new offer v3; the club can't answer its own offer
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := make_offer(app_b, (now() + interval '12 days')::date);
    off_3 := (v_res->>'offer_id')::uuid;
    BEGIN
      PERFORM respond_offer(off_3, true, NULL);
      v_txt := 'club accepted its own offer';
    EXCEPTION WHEN others THEN
      v_txt := 'club answer refused (' || SQLERRM || ')';
    END;
    EXECUTE 'RESET ROLE';
    v_line := format('%s B12 offer v%s; %s', CASE WHEN v_txt LIKE 'club answer refused%' AND v_res->>'version' = '3' THEN 'PASS' ELSE 'FAIL' END,
                     v_res->>'version', v_txt);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B12 offer v3 → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B13 player declines → recorded as offer_declined, back to shortlisted, club told
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := respond_offer(off_3, false, 'Timing');
    EXECUTE 'RESET ROLE';
    SELECT a.status::text INTO v_txt FROM opportunity_applications a WHERE a.id = app_b;
    SELECT format('offered>offer_declined=%s offer_declined>shortlisted=%s',
                  count(*) FILTER (WHERE old_status::text = 'offered' AND new_status::text = 'offer_declined'),
                  count(*) FILTER (WHERE old_status::text = 'offer_declined' AND new_status::text = 'shortlisted'))
      INTO v_txt2 FROM application_status_history WHERE application_id = app_b;
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_club AND kind = 'recruiting_update' AND source_entity_id = app_b
       AND metadata->>'event' = 'offer_declined';
    v_line := format('%s B13 decline → app=%s, club told=%s, history: %s',
                     CASE WHEN v_txt = 'shortlisted' AND v_n = 1 AND v_txt2 = 'offered>offer_declined=1 offer_declined>shortlisted=1' THEN 'PASS' ELSE 'FAIL' END,
                     v_txt, v_n, v_txt2);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B13 decline → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B14 trial (club only), offer v4, player accepts
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM set_trial(app_b, true);
      v_txt2 := 'player set trial';
    EXCEPTION WHEN others THEN
      v_txt2 := 'player trial refused';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_trial(app_b, true);
    v_res := make_offer(app_b, (now() + interval '12 days')::date, (now() + interval '30 days')::date);
    EXECUTE 'RESET ROLE';
    off_4 := (v_res->>'offer_id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := respond_offer(off_4, true, NULL);
    EXECUTE 'RESET ROLE';
    SELECT a.status::text || '/trial=' || a.trial INTO v_txt FROM opportunity_applications a WHERE a.id = app_b;
    v_line := format('%s B14 %s; club trial + offer v4 accepted → %s',
                     CASE WHEN v_txt = 'accepted/trial=true' AND v_txt2 = 'player trial refused' THEN 'PASS' ELSE 'FAIL' END, v_txt2, v_txt);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B14 accept → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B15 only a recruiter who owns the role can mark signed
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := mark_signed(app_b, true);
    v_line := 'FAIL B15a player marks own signing → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Only clubs and coaches who recruit%' THEN 'PASS' ELSE 'FAIL' END || ' B15a player marks own signing → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := mark_signed(app_b, true);
    v_line := 'FAIL B15b other recruiter marks the signing → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE 'Application not found' THEN 'PASS' ELSE 'FAIL' END || ' B15b other recruiter marks the signing → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B16 mark signed, undo while waiting (→ accepted), mark again
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM mark_signed(app_b, true);
    v_res := undo_mark_signed(app_b);
    v_txt := v_res->>'status';
    PERFORM mark_signed(app_b, true);
    EXECUTE 'RESET ROLE';
    SELECT a.status::text INTO v_txt2 FROM opportunity_applications a WHERE a.id = app_b;
    v_line := format('%s B16 mark → undo → %s → mark again → %s',
                     CASE WHEN v_txt = 'accepted' AND v_txt2 = 'signed_pending_confirmation' THEN 'PASS' ELSE 'FAIL' END, v_txt, v_txt2);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B16 mark/undo → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B17 recruiting cards can't be edited or deleted by their sender; read receipts still work
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM edit_message(msg_invite, 'changed');
      v_txt := 'edit allowed';
    EXCEPTION WHEN others THEN
      v_txt := 'edit refused';
    END;
    BEGIN
      PERFORM delete_message(msg_offer);
      v_txt := v_txt || ', delete allowed';
    EXCEPTION WHEN others THEN
      v_txt := v_txt || ', delete refused';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE messages SET read_at = now() WHERE id = msg_offer AND read_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    v_line := format('%s B17 card: %s; recipient read receipt rows=%s',
                     CASE WHEN v_txt = 'edit refused, delete refused' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_txt, v_n);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B17 cards → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B18 player confirms → signed, career entry, squad, hidden from clubs, role filled via Hockia
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := confirm_signing(app_b, true);
    EXECUTE 'RESET ROLE';
    SELECT a.status::text || '/' || (a.signed_at IS NOT NULL)::text INTO v_txt FROM opportunity_applications a WHERE a.id = app_b;
    SELECT count(*) INTO v_n FROM career_history WHERE application_id = app_b AND signed_via_hockia AND user_id = c_player AND years ~ '^[0-9]{4}–[0-9]{2}$';
    SELECT count(*) INTO v_m FROM club_members WHERE club_profile_id = c_club AND member_profile_id = c_player AND status = 'active';
    SELECT o.status::text || '/' || coalesce(o.closed_reason, '-') || '/' || coalesce(o.filled_via_hockia::text, '-') || '/open_to_play=' || p.open_to_play
      INTO v_txt2 FROM opportunities o, profiles p WHERE o.id = o2 AND p.id = c_player;
    v_line := format('%s B18 confirm → app=%s career(season style)=%s squad=%s role/profile=%s',
                     CASE WHEN v_txt = 'signed/true' AND v_n = 1 AND v_m = 1 AND v_txt2 = 'closed/filled/true/open_to_play=false' THEN 'PASS' ELSE 'FAIL' END,
                     v_txt, v_n, v_m, v_txt2);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B18 confirm → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B19 no withdrawal after confirming
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := withdraw_application(app_b);
    v_line := 'FAIL B19 withdraw a confirmed signing → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := CASE WHEN SQLERRM LIKE '%confirmed signing can''t be withdrawn' THEN 'PASS' ELSE 'FAIL' END || ' B19 withdraw a confirmed signing → refused (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- B20 career entry: club/season/"Signed through Hockia" locked; hide and delete allowed;
  --     deleting doesn't change the signing count; a client can't create a signed entry
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      UPDATE career_history SET club_name = 'Another club' WHERE application_id = app_b;
      v_txt := 'club edit allowed';
    EXCEPTION WHEN others THEN v_txt := 'club edit refused'; END;
    BEGIN
      UPDATE career_history SET years = '1999' WHERE application_id = app_b;
      v_txt := v_txt || ', season edit allowed';
    EXCEPTION WHEN others THEN v_txt := v_txt || ', season edit refused'; END;
    BEGIN
      UPDATE career_history SET signed_via_hockia = false WHERE application_id = app_b;
      v_txt := v_txt || ', badge edit allowed';
    EXCEPTION WHEN others THEN v_txt := v_txt || ', badge edit refused'; END;
    UPDATE career_history SET is_hidden = true, highlights = ARRAY['Probe'] WHERE application_id = app_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO career_history (user_id, club_name, position_role, years, division_league, signed_via_hockia, signed_at)
    VALUES (c_player, 'Fake FC', 'Midfielder', '2026', '', true, now())
    RETURNING signed_via_hockia::text INTO v_txt2;
    DELETE FROM career_history WHERE application_id = app_b;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    SELECT EXISTS (SELECT 1 FROM opportunity_applications WHERE id = app_b AND status::text = 'signed') INTO v_bool;
    v_line := format('%s B20 career: %s; hide rows=%s; client insert signed=%s; delete rows=%s; signing still counted=%s',
                     CASE WHEN v_txt = 'club edit refused, season edit refused, badge edit refused' AND v_n = 1
                               AND v_txt2 = 'false' AND v_m = 1 AND v_bool THEN 'PASS' ELSE 'FAIL' END,
                     v_txt, v_n, v_txt2, v_m, v_bool);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B20 career guard → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- B21 history records the real actor (club made the offer, player accepted/confirmed)
  BEGIN
    SELECT string_agg(new_status::text || '=' || CASE changed_by WHEN c_club THEN 'club' WHEN c_player THEN 'player' ELSE coalesce(changed_by::text, 'system') END,
                      ' ' ORDER BY created_at, new_status::text)
      INTO v_txt FROM application_status_history WHERE application_id = app_b AND new_status::text IN ('offered', 'accepted', 'signed');
    v_line := format('%s B21 history actors: %s',
                     CASE WHEN v_txt LIKE '%offered=club%' AND v_txt LIKE '%accepted=player%' AND v_txt LIKE '%signed=player%'
                               AND v_txt NOT LIKE '%offered=player%' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL B21 history → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- ════ C · withdrawals and filled roles ═════════════════════════════════════════

  -- C1 normal Apply (client INSERT) still works; server-only columns can't be set
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, invite_id, trial, signed_at)
    VALUES (o4, c_player, 'signed', inv_a3, true, now())
    RETURNING id INTO app_c;
    EXECUTE 'RESET ROLE';
    SELECT a.status::text || '/' || coalesce(a.invite_id::text, 'null') || '/' || a.trial || '/' || coalesce(a.signed_at::text, 'null')
      INTO v_txt FROM opportunity_applications a WHERE a.id = app_c;
    v_line := format('%s C1 client apply with forged fields → %s', CASE WHEN v_txt = 'pending/null/false/null' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL C1 client apply → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- C2 player withdraws a pending application; the club is told; actor = player
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := withdraw_application(app_c);
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_club AND kind = 'recruiting_update' AND source_entity_id = app_c
       AND metadata->>'event' = 'application_withdrawn';
    SELECT (changed_by = c_player)::text INTO v_txt FROM application_status_history
     WHERE application_id = app_c AND new_status::text = 'withdrawn';
    v_line := format('%s C2 withdraw pending → club told=%s, actor is player=%s',
                     CASE WHEN v_n = 1 AND v_txt = 'true' THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL C2 withdraw → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- C3 player withdraws while the signing waits for them
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
    VALUES (o6, c_player, 'shortlisted') RETURNING id INTO app_f;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM mark_signed(app_f, false);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := withdraw_application(app_f);
    EXECUTE 'RESET ROLE';
    SELECT a.status::text INTO v_txt FROM opportunity_applications a WHERE a.id = app_f;
    v_line := format('%s C3 withdraw while signing waits → %s', CASE WHEN v_txt = 'withdrawn' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL C3 withdraw while signing waits → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- C4 fill_role: only the owner; every waiting application gets status filled + the note
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
    VALUES (o5, c_player, 'pending') RETURNING id INTO app_e;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM fill_role(o5);
      v_txt2 := 'other recruiter filled it';
    EXCEPTION WHEN others THEN
      v_txt2 := 'other recruiter refused';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := fill_role(o5);
    EXECUTE 'RESET ROLE';
    SELECT a.status::text INTO v_txt FROM opportunity_applications a WHERE a.id = app_e;
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = app_e
       AND metadata->>'status' = 'filled';
    v_line := format('%s C4 fill_role: %s; waiting app → %s, kind note=%s',
                     CASE WHEN v_txt2 = 'other recruiter refused' AND v_txt = 'filled' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_txt2, v_txt, v_n);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL C4 fill_role → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- C5 existing "Close as filled" from the club UI also sends the note (trigger)
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
    VALUES (o1, c_player, 'maybe') RETURNING id INTO app_e;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunities SET status = 'closed', closed_reason = 'filled' WHERE id = o1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    SELECT a.status::text INTO v_txt FROM opportunity_applications a WHERE a.id = app_e;
    v_line := format('%s C5 club closes role as filled directly (%s row) → waiting app %s',
                     CASE WHEN v_n = 1 AND v_txt = 'filled' THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL C5 close as filled → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- C6 existing flow: a club still rejects a pending application directly
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
    VALUES (o7, c_player, 'pending') RETURNING id INTO app_e;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET status = 'rejected', metadata = jsonb_build_object('status_reason', 'timing') WHERE id = app_e;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    SELECT a.status::text || '/' || coalesce(a.metadata->>'status_reason', '-') INTO v_txt FROM opportunity_applications a WHERE a.id = app_e;
    SELECT (changed_by = c_club)::text INTO v_txt2 FROM application_status_history WHERE application_id = app_e AND new_status::text = 'rejected';
    v_line := format('%s C6 club rejects directly → %s, actor is club=%s',
                     CASE WHEN v_n = 1 AND v_txt = 'rejected/timing' AND v_txt2 = 'true' THEN 'PASS' ELSE 'FAIL' END, v_txt, v_txt2);
  EXCEPTION WHEN others THEN
    v_line := 'FAIL C6 club rejects directly → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- ════ E · "filled through Hockia" only from a confirmed signing ═══════════════

  -- E1 a club closing a role can't claim filled_via_hockia (kept as stored)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunities SET status = 'closed', closed_reason = 'filled', filled_via_hockia = true WHERE id = o7;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    SELECT o.status::text || '/' || coalesce(o.closed_reason, '-') || '/' || coalesce(o.filled_via_hockia::text, 'null')
      INTO v_txt FROM opportunities o WHERE o.id = o7;
    v_line := format('%s E1 club closes as filled claiming via Hockia (%s row) → %s',
                     CASE WHEN v_n = 1 AND v_txt = 'closed/filled/null' THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL E1 close as filled → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- E2 a club creating a role can't pre-set it; clearing on reopen still works
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, filled_via_hockia)
    VALUES (c_club, 'player', '[PROBE] Track C role E2', 'Dublin', 'Ireland', 'draft', true)
    RETURNING coalesce(filled_via_hockia::text, 'null') INTO v_txt;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE opportunities SET status = 'closed', closed_reason = 'filled', filled_via_hockia = true WHERE id = o6;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunities SET status = 'open', closed_reason = NULL, filled_via_hockia = NULL WHERE id = o6;
    EXECUTE 'RESET ROLE';
    SELECT coalesce(filled_via_hockia::text, 'null') INTO v_txt2 FROM opportunities WHERE id = o6;
    v_line := format('%s E2 client insert with via Hockia → %s; reopen clears server value → %s',
                     CASE WHEN v_txt = 'null' AND v_txt2 = 'null' THEN 'PASS' ELSE 'FAIL' END, v_txt, v_txt2);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL E2 insert/reopen → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
