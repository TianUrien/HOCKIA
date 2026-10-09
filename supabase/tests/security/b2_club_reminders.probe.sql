-- Probe for 20261009100000_b2_club_reminders.sql: who the reminder job may
-- mention (fences), that every send is claimed once (idempotency), that a push
-- claim writes the notification, the new-applications hourly gap, the day-10
-- skip log, answered-in-24h, and that clients cannot reach any of it.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement (settings,
-- fixtures, log rows, notifications and any queued webhook requests).
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (not the publisher here)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (applicant)
  v_today  constant date := timezone('utc', now())::date;
  o_one uuid; o_two uuid; a_last uuid; a_new uuid;
  v_b1 uuid; v_b2 uuid; v_id uuid;
  v_n int; v_txt text; v_bool boolean; v_date date;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE application_response_settings
     SET club_reminders_enabled = true, sweep_enabled = true,
         launch_date = now() - interval '60 days', expiry_days = 14,
         batched_application_emails_since = now() - interval '1 hour';

  DELETE FROM opportunity_applications a USING opportunities o
   WHERE o.id = a.opportunity_id AND o.club_id = c_club AND a.applicant_id = c_player;
  DELETE FROM user_blocks
   WHERE (blocker_id = c_player AND blocked_id = c_club) OR (blocker_id = c_club AND blocked_id = c_player);
  UPDATE profiles SET onboarding_completed = true, is_blocked = false, frozen_minor_at = NULL, notify_applications = true
   WHERE id = c_club;
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL,
                      dob_required_since = NULL, is_blocked = false, onboarding_completed = true
   WHERE id = c_player;

  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] B2 role one', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o_one;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] B2 role two', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o_two;

  -- Applied 13 days ago → closes at the first 08:00 UTC sweep after tomorrow-ish.
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, applied_at)
  VALUES (o_one, c_player, 'pending', now() - interval '13 days') RETURNING id INTO a_last;
  -- Applied just now → a new application for the batched email.
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, applied_at)
  VALUES (o_two, c_player, 'pending', now()) RETURNING id INTO a_new;

  -- ── A · who is listed (reminders) ────────────────────────────────────────────
  SELECT count(*), bool_and(c.closes_at IS NOT NULL AND c.closes_at > now()) INTO v_n, v_bool
    FROM club_reminder_candidates('reminders') c WHERE c.application_id = a_last;
  v_out := v_out || E'\n' || format('%s A1 a pending application on an open role is listed with its close time (rows=%s, future close=%s)',
    CASE WHEN v_n = 1 AND v_bool THEN 'PASS' ELSE 'FAIL' END, v_n, v_bool);

  UPDATE profiles SET is_blocked = true WHERE id = c_player;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('reminders') c WHERE c.applicant_id = c_player;
  v_out := v_out || E'\n' || format('%s A2 a banned applicant is in no row (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE profiles SET is_blocked = false WHERE id = c_player;

  UPDATE profiles SET frozen_minor_at = now() WHERE id = c_player;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('reminders') c WHERE c.applicant_id = c_player;
  v_out := v_out || E'\n' || format('%s A3 a frozen applicant is in no row (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_player;

  UPDATE profiles SET date_of_birth = (current_date - interval '16 years')::date WHERE id = c_player;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('reminders') c WHERE c.applicant_id = c_player;
  v_out := v_out || E'\n' || format('%s A4 a known minor is in no row (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL WHERE id = c_player;

  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_club, c_player);
  SELECT count(*) INTO v_n FROM club_reminder_candidates('reminders') c WHERE c.applicant_id = c_player;
  v_out := v_out || E'\n' || format('%s A5 a blocked pair is in no row (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  DELETE FROM user_blocks WHERE blocker_id = c_club AND blocked_id = c_player;

  UPDATE application_response_settings SET club_reminders_enabled = false;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('reminders');
  v_out := v_out || E'\n' || format('%s A6 switch off → no candidates at all (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE application_response_settings SET club_reminders_enabled = true;

  -- ── B · claims are idempotent ───────────────────────────────────────────────
  v_b1 := club_reminder_claim(c_club, 'email', 'reminder', v_today, jsonb_build_array(jsonb_build_object('application_id', a_last, 'kind', 'last_call')));
  v_out := v_out || E'\n' || format('%s B1 first reminder email claim → batch %s', CASE WHEN v_b1 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b1::text, 'NULL'));

  v_b2 := club_reminder_claim(c_club, 'email', 'reminder', v_today, jsonb_build_array(jsonb_build_object('application_id', a_last, 'kind', 'closing_soon')));
  v_out := v_out || E'\n' || format('%s B2 a second reminder email the same local day → %s', CASE WHEN v_b2 IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b2::text, 'NULL'));

  v_b2 := club_reminder_claim(c_club, 'email', 'reminder', v_today + 1, jsonb_build_array(jsonb_build_object('application_id', a_last, 'kind', 'last_call')));
  SELECT count(*) INTO v_n FROM club_reminder_batches WHERE publisher_id = c_club AND local_date = v_today + 1;
  v_out := v_out || E'\n' || format('%s B3 the same item another day → %s, no stray batch (%s)',
    CASE WHEN v_b2 IS NULL AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b2::text, 'NULL'), v_n);

  PERFORM club_reminder_finish(v_b1, false);
  SELECT count(*) INTO v_n FROM club_reminder_log WHERE application_id = a_last;
  v_b1 := club_reminder_claim(c_club, 'email', 'reminder', v_today, jsonb_build_array(jsonb_build_object('application_id', a_last, 'kind', 'last_call')));
  PERFORM club_reminder_finish(v_b1, true);
  SELECT status INTO v_txt FROM club_reminder_batches WHERE id = v_b1;
  v_out := v_out || E'\n' || format('%s B4 a failed send releases the claim (log rows after release=%s), the retry claims and is marked %s',
    CASE WHEN v_n = 0 AND v_b1 IS NOT NULL AND v_txt = 'sent' THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_txt, 'NULL'));

  SELECT bool_and(c.email_last_call_logged), max(c.last_reminder_email_date) INTO v_bool, v_date
    FROM club_reminder_candidates('reminders') c WHERE c.application_id = a_last;
  v_out := v_out || E'\n' || format('%s B5 candidates report the logged item and today''s email (logged=%s, last=%s)',
    CASE WHEN v_bool AND v_date = v_today THEN 'PASS' ELSE 'FAIL' END, v_bool, v_date);

  v_id := club_reminder_claim(c_coach, 'email', 'reminder', v_today, jsonb_build_array(jsonb_build_object('application_id', a_last, 'kind', 'closing_soon')));
  SELECT count(*) INTO v_n FROM club_reminder_batches WHERE publisher_id = c_coach AND local_date = v_today;
  v_out := v_out || E'\n' || format('%s B6 a claim naming someone else''s application → %s, no batch left (%s)',
    CASE WHEN v_id IS NULL AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, coalesce(v_id::text, 'NULL'), v_n);

  -- ── C · the push claim writes the notification ───────────────────────────────
  v_id := club_reminder_claim(c_club, 'push', 'reminder', v_today,
            jsonb_build_array(jsonb_build_object('application_id', a_last, 'kind', 'last_call')),
            jsonb_build_object('kind', 'applicant_last_call', 'target_url', '/opportunities',
                               'metadata', jsonb_build_object('title', 'Last day to answer Probe', 'summary', 'Probe summary')));
  SELECT count(*) INTO v_n FROM profile_notifications
   WHERE recipient_profile_id = c_club AND kind = 'applicant_last_call' AND metadata->>'title' = 'Last day to answer Probe';
  v_out := v_out || E'\n' || format('%s C1 push claim → batch %s and one applicant_last_call notification (%s)',
    CASE WHEN v_id IS NOT NULL AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, coalesce(v_id::text, 'NULL'), v_n);

  BEGIN
    PERFORM club_reminder_claim(c_club, 'push', 'reminder', v_today + 2,
              jsonb_build_array(jsonb_build_object('application_id', a_new, 'kind', 'closing_soon')),
              jsonb_build_object('kind', 'message_received'));
    v_line := 'FAIL C2 a push claim with another notification kind → accepted';
  EXCEPTION WHEN others THEN
    v_line := 'PASS C2 a push claim with another notification kind → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;

  -- ── D · new applications, hourly gap ────────────────────────────────────────
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_applications') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s D1 an application since the switch is listed for the batch (rows=%s)',
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_applications') c WHERE c.application_id = a_last;
  v_out := v_out || E'\n' || format('%s D2 an application from before the switch is not (rows=%s)',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  v_b1 := club_reminder_claim(c_club, 'email', 'new_applications', v_today, jsonb_build_array(jsonb_build_object('application_id', a_new, 'kind', 'new_application')));
  PERFORM club_reminder_finish(v_b1, true);
  SELECT count(*) INTO v_n FROM club_reminder_candidates('new_applications') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s D3 batch claimed (%s); the application is not listed again (rows=%s)',
    CASE WHEN v_b1 IS NOT NULL AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b1::text, 'NULL'), v_n);

  DELETE FROM club_reminder_log WHERE batch_id = v_b1;  -- pretend another application arrived
  v_b2 := club_reminder_claim(c_club, 'email', 'new_applications', v_today, jsonb_build_array(jsonb_build_object('application_id', a_new, 'kind', 'new_application')));
  v_out := v_out || E'\n' || format('%s D4 a second batch inside the hour → %s', CASE WHEN v_b2 IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v_b2::text, 'NULL'));

  -- ── E · skip log ─────────────────────────────────────────────────────────────
  v_n := club_reminder_skip(c_club, v_today, ARRAY[a_new]);
  v_out := v_out || E'\n' || format('%s E1 the day-10 skip logs Closing soon for both channels (rows=%s)', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);
  v_n := club_reminder_skip(c_club, v_today, ARRAY[a_new]);
  v_out := v_out || E'\n' || format('%s E2 a re-run writes nothing (rows=%s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── G · answered in the last 24 h; an answer stops the reminders ─────────────
  UPDATE opportunity_applications SET status = 'shortlisted' WHERE id = a_new;
  SELECT bool_and(c.answered_last_24h) INTO v_bool FROM club_reminder_candidates('reminders') c WHERE c.publisher_id = c_club;
  SELECT count(*) INTO v_n FROM club_reminder_candidates('reminders') c WHERE c.application_id = a_new;
  v_out := v_out || E'\n' || format('%s G1 answering sets answered_last_24h (%s) and the answered application leaves the list (rows=%s)',
    CASE WHEN v_bool AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_bool, v_n);

  -- ── F · clients cannot reach any of it ───────────────────────────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM * FROM club_reminder_candidates('reminders');
    v_line := 'FAIL F1 the club executes club_reminder_candidates → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F1 the club executes club_reminder_candidates → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM count(*) FROM club_reminder_log;
    v_line := 'FAIL F2 the club reads club_reminder_log → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F2 the club reads club_reminder_log → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM club_reminder_claim(c_club, 'email', 'reminder', v_today + 3, jsonb_build_array(jsonb_build_object('application_id', a_last, 'kind', 'last_call')));
    v_line := 'FAIL F3 anon claims a reminder → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F3 anon claims a reminder → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM run_club_reminders('reminders');
    v_line := 'FAIL F4 a player runs the scheduler → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS F4 a player runs the scheduler → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  -- The candidates function restores the caller's JWT claims after setting each publisher.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM * FROM club_reminder_candidates('reminders');
  v_txt := current_setting('request.jwt.claims', true);
  v_out := v_out || E'\n' || format('%s H1 claims restored after the candidates call (%s)',
    CASE WHEN v_txt = '{"role":"service_role"}' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
