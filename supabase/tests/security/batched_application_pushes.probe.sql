-- Probe for 20261021160000_batched_application_pushes.sql: the grouped
-- new-application push mode (who is listed, fences, preferences), the hourly
-- gap per channel (email and push independent), and that the switch is off by
-- default and clients cannot reach any of it.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL
-- editor or MCP execute_sql, AFTER the migration. Nothing is kept: the block
-- ends by raising 'PROBE RESULTS', which rolls back the whole statement.
-- One line per case: PASS <case> → <detail> | FAIL <case> → <detail>.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (applicant)
  v_today  constant date := timezone('utc', now())::date;
  o_one uuid; a_old uuid; a_new uuid;
  v_b1 uuid; v_b2 uuid; v_e1 uuid;
  v_n int; v_txt text; v_ts timestamptz;
  v_out text := '';
  v_line text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── Z · deploy-dark ──────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM application_response_settings WHERE batched_application_pushes_since IS NOT NULL;
  v_out := v_out || E'\n' || format('%s Z1 the push switch is off until set (rows with it set=%s)',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes');
  v_out := v_out || E'\n' || format('%s Z2 switch off → no push candidates (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── fixtures ─────────────────────────────────────────────────────────────────
  UPDATE application_response_settings
     SET batched_application_pushes_since = now() - interval '1 hour',
         batched_application_emails_since = now() - interval '1 hour';
  DELETE FROM opportunity_applications a USING opportunities o
   WHERE o.id = a.opportunity_id AND o.club_id = c_club AND a.applicant_id = c_player;
  DELETE FROM user_blocks
   WHERE (blocker_id = c_player AND blocked_id = c_club) OR (blocker_id = c_club AND blocked_id = c_player);
  UPDATE profiles SET onboarding_completed = true, is_blocked = false, frozen_minor_at = NULL,
                      notify_applications = true, notify_push = true
   WHERE id = c_club;
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL,
                      dob_required_since = NULL, is_blocked = false, onboarding_completed = true
   WHERE id = c_player;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] push batch role', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o_one;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, applied_at)
  VALUES (o_one, c_player, 'pending', now()) RETURNING id INTO a_new;

  -- ── A · who is listed ────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s A1 an application since the switch is listed for the grouped push (rows=%s)',
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  UPDATE opportunity_applications SET applied_at = now() - interval '2 hours' WHERE id = a_new;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s A2 an application from before the switch is not (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE opportunity_applications SET applied_at = now() WHERE id = a_new;

  UPDATE profiles SET is_blocked = true WHERE id = c_player;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.applicant_id = c_player;
  v_out := v_out || E'\n' || format('%s A3 a banned applicant is in no row (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE profiles SET is_blocked = false WHERE id = c_player;
  -- A ban withdraws the player's applications: put the fixture back.
  UPDATE opportunity_applications SET status = 'pending' WHERE id = a_new;

  UPDATE profiles SET date_of_birth = (current_date - interval '16 years')::date WHERE id = c_player;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.applicant_id = c_player;
  v_out := v_out || E'\n' || format('%s A4 a known minor is in no row (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL WHERE id = c_player;
  UPDATE opportunity_applications SET status = 'pending' WHERE id = a_new;

  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_club, c_player);
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.applicant_id = c_player;
  v_out := v_out || E'\n' || format('%s A5 a blocked pair is in no row (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  DELETE FROM user_blocks WHERE blocker_id = c_club AND blocked_id = c_player;

  UPDATE profiles SET notify_push = false WHERE id = c_club;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s A6 push off for the club → not listed (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE profiles SET notify_push = true, notify_applications = false WHERE id = c_club;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s A7 application notifications off → not listed (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE profiles SET notify_applications = true WHERE id = c_club;
  UPDATE opportunity_applications SET status = 'pending' WHERE id = a_new;

  -- Positive control: with every fence lifted the application is listed again,
  -- so the negative cases above failed for the right reason.
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s A8 fixture restored → listed again (rows=%s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── B · claims: hourly, per channel ──────────────────────────────────────────
  v_b1 := club_reminder_claim(c_club, 'push', 'new_applications', v_today,
            jsonb_build_array(jsonb_build_object('application_id', a_new, 'kind', 'new_application')));
  PERFORM club_reminder_finish(v_b1, true);
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_application_pushes') c WHERE c.application_id = a_new;
  SELECT max(c.last_new_applications_email_at) INTO v_ts FROM club_reminder_candidates('new_applications') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s B1 push batch claimed (%s); not listed for push again (rows=%s); the email batch clock is untouched (%s)',
    CASE WHEN v_b1 IS NOT NULL AND v_n = 0 AND v_ts IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b1::text, 'NULL'), v_n, coalesce(v_ts::text, 'NULL'));

  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_applications') c WHERE c.application_id = a_new;
  v_e1 := club_reminder_claim(c_club, 'email', 'new_applications', v_today,
            jsonb_build_array(jsonb_build_object('application_id', a_new, 'kind', 'new_application')));
  v_out := v_out || E'\n' || format('%s B2 the email batch still lists (rows=%s) and claims (%s) the same application',
    CASE WHEN v_n = 1 AND v_e1 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_e1::text, 'NULL'));

  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, applied_at)
  SELECT o_one, p.id, 'pending', now()
    FROM profiles p
   WHERE p.id NOT IN (c_club, c_player) AND p.role = 'player' AND NOT p.is_blocked
   LIMIT 1
  RETURNING id INTO a_old;
  IF a_old IS NULL THEN
    v_out := v_out || E'\n' || 'FAIL B3 fixture: no second player to apply';
  ELSE
    v_b2 := club_reminder_claim(c_club, 'push', 'new_applications', v_today,
              jsonb_build_array(jsonb_build_object('application_id', a_old, 'kind', 'new_application')));
    v_out := v_out || E'\n' || format('%s B3 a second push batch inside the hour → %s', CASE WHEN v_b2 IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b2::text, 'NULL'));
    UPDATE club_reminder_batches SET created_at = now() - interval '61 minutes' WHERE id = v_b1;
    v_b2 := club_reminder_claim(c_club, 'push', 'new_applications', v_today,
              jsonb_build_array(jsonb_build_object('application_id', a_old, 'kind', 'new_application')));
    v_out := v_out || E'\n' || format('%s B4 after the hour the next push batch claims → %s', CASE WHEN v_b2 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b2::text, 'NULL'));
  END IF;

  BEGIN
    PERFORM club_reminder_claim(c_club, 'push', 'new_applications', v_today,
              jsonb_build_array(jsonb_build_object('application_id', a_new, 'kind', 'new_application')),
              jsonb_build_object('kind', 'vacancy_application_received'));
    v_line := 'FAIL B5 a new-applications claim that tries to write a notification → accepted';
  EXCEPTION WHEN others THEN
    v_line := 'PASS B5 a new-applications claim that tries to write a notification → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- ── F · clients cannot reach it ──────────────────────────────────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM * FROM club_reminder_candidates('new_application_pushes');
    v_line := 'FAIL F1 the club executes the push candidates → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F1 the club executes the push candidates → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM club_reminder_claim(c_club, 'push', 'new_applications', v_today + 3,
              jsonb_build_array(jsonb_build_object('application_id', a_new, 'kind', 'new_application')));
    v_line := 'FAIL F2 anon claims a push batch → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F2 anon claims a push batch → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM * FROM club_reminder_candidates('new_application_pushes');
  v_txt := current_setting('request.jwt.claims', true);
  v_out := v_out || E'\n' || format('%s H1 claims restored after the push candidates call (%s)',
    CASE WHEN v_txt = '{"role":"service_role"}' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
