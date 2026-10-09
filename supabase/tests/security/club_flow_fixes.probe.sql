-- Probe for 20261009200000_club_flow_fixes.sql: the club recruiting flow fixes.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement.
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated + request.jwt.claims,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT
-- (they stand in for the server functions, which run as the owner).
-- Applications in a server-only state (offered, signed, …) are set up the way
-- signing_current_club.probe.sql does it: sys inserts them in that state.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (publisher, recruits)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (applies)
  c_org    constant text := '[PROBE] Coach Org';
  v_today  constant date := timezone('utc', now())::date;
  v_club_name text;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid;
  v_n int; v_txt text; v_txt2 text; v_id uuid; v_ts timestamptz; v_ok boolean;
  v_out text := '';
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT full_name INTO v_club_name FROM profiles WHERE id = c_club;

  -- A clean slate between the publishers and the player (rolled back at the end).
  DELETE FROM opportunity_invites WHERE club_id IN (c_club, c_coach) AND player_id = c_player;
  DELETE FROM opportunity_applications a USING opportunities o
   WHERE o.id = a.opportunity_id AND o.club_id IN (c_club, c_coach) AND a.applicant_id = c_player;
  DELETE FROM user_blocks
   WHERE (blocker_id = c_player AND blocked_id IN (c_club, c_coach)) OR (blocker_id IN (c_club, c_coach) AND blocked_id = c_player);
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL,
                      dob_required_since = NULL, is_blocked = false, onboarding_completed = true
   WHERE id = c_player;

  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] club flow · 1', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o1;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] club flow · 2', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o2;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] club flow · 3', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o3;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] club flow · 4', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o4;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date, organization_name)
  VALUES (c_coach, 'player', '[PROBE] club flow · coach', 'Dublin', 'Ireland', 'open', v_today, c_org) RETURNING id INTO o5;

  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o1, c_player, 'pending') RETURNING id INTO a1;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o2, c_player, 'pending') RETURNING id INTO a2;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o3, c_player, 'pending') RETURNING id INTO a3;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o4, c_player, 'offered') RETURNING id INTO a4;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o5, c_player, 'pending') RETURNING id INTO a5;

  -- ══ A · a decline after Good fit / Maybe tells the player ═════════════════════

  -- A1 pending → shortlisted (as the club, like the client): one message, status shortlisted.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'shortlisted' WHERE id = a1;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*), max(metadata->>'status') INTO v_n, v_txt
    FROM profile_notifications WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a1;
  v_out := v_out || E'\n' || format('%s A1 pending → shortlisted → %s message(s), status %s',
    CASE WHEN v_n = 1 AND v_txt = 'shortlisted' THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_txt, 'NULL'));

  -- The Good fit email went out (the status-email scan marks the row).
  UPDATE profile_notifications SET emailed_at = timezone('utc', now()) - interval '1 hour'
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a1;

  -- A2 shortlisted → rejected with the club's note: still ONE message, now rejected,
  -- named after the club, and emailable again (emailed_at reset).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'rejected', metadata = jsonb_build_object('status_reason', 'timing') WHERE id = a1;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*), max(metadata->>'status'), max(metadata->>'club_name'), bool_and(emailed_at IS NULL)
    INTO v_n, v_txt, v_txt2, v_ok
    FROM profile_notifications WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a1;
  v_out := v_out || E'\n' || format('%s A2 shortlisted → rejected → %s message(s), status %s, club "%s", emailable again %s',
    CASE WHEN v_n = 1 AND v_txt = 'rejected' AND v_txt2 IS NOT DISTINCT FROM v_club_name AND v_ok THEN 'PASS' ELSE 'FAIL' END,
    v_n, coalesce(v_txt, 'NULL'), coalesce(v_txt2, 'NULL'), coalesce(v_ok::text, 'NULL'));

  -- A3 the status-email scan picks the decline up (the arming flag is forced on inside
  -- this rolled-back statement) and the club's note is on the application, where the
  -- email reads it (ai_feedback with the same status).
  UPDATE application_response_settings SET status_emails_enabled = true;
  UPDATE opportunity_applications
     SET ai_feedback = jsonb_build_object('message', '[PROBE] note', 'status', 'rejected', 'reason', 'timing', 'source', 'club')
   WHERE id = a1;
  SELECT id INTO v_id FROM profile_notifications
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a1;
  PERFORM public.enqueue_application_status_emails();
  SELECT count(*) INTO v_n FROM application_status_email_queue q
   WHERE q.recipient_id = c_player AND v_id = ANY (q.notification_ids) AND q.processed_at IS NULL;
  -- Expected 1 when the E2E player takes application emails, 0 otherwise.
  SELECT coalesce(notify_applications AND email IS NOT NULL, false) INTO v_ok FROM profiles WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s A3 the decline is queued for its email → %s batch(es) (player emailable: %s)',
    CASE WHEN v_n = CASE WHEN v_ok THEN 1 ELSE 0 END THEN 'PASS' ELSE 'FAIL' END, v_n, v_ok);

  -- A4 rejected → pending → rejected: the same message is not sent twice (row untouched).
  UPDATE profile_notifications SET metadata = metadata || '{"probe_mark": true}'::jsonb,
                                   emailed_at = timezone('utc', now()) - interval '1 hour'
   WHERE id = v_id;
  DELETE FROM application_status_email_queue WHERE recipient_id = c_player AND v_id = ANY (notification_ids);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'pending' WHERE id = a1;
  UPDATE opportunity_applications SET status = 'rejected' WHERE id = a1;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*), bool_and(metadata ? 'probe_mark' AND emailed_at IS NOT NULL) INTO v_n, v_ok
    FROM profile_notifications WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a1;
  v_out := v_out || E'\n' || format('%s A4 rejected → pending → rejected → %s message(s), not re-sent %s',
    CASE WHEN v_n = 1 AND v_ok THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_ok::text, 'NULL'));

  -- A5 pending → maybe stays silent; maybe → shortlisted tells the player.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'maybe' WHERE id = a2;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM profile_notifications
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'shortlisted' WHERE id = a2;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT max(metadata->>'status') INTO v_txt FROM profile_notifications
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a2;
  v_out := v_out || E'\n' || format('%s A5 pending → maybe → %s message(s); maybe → shortlisted → status %s',
    CASE WHEN v_n = 0 AND v_txt = 'shortlisted' THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_txt, 'NULL'));

  -- A6 maybe → rejected tells the player.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'maybe' WHERE id = a3;
  UPDATE opportunity_applications SET status = 'rejected' WHERE id = a3;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*), max(metadata->>'status') INTO v_n, v_txt FROM profile_notifications
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a3;
  v_out := v_out || E'\n' || format('%s A6 maybe → rejected → %s message(s), status %s',
    CASE WHEN v_n = 1 AND v_txt = 'rejected' THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_txt, 'NULL'));

  -- A7 a batch still waiting to send holds the row: emailed_at is left alone (that
  -- batch reads the current status when it sends, so nothing is sent twice).
  UPDATE profile_notifications SET emailed_at = timezone('utc', now()) - interval '1 minute'
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a2
   RETURNING id INTO v_id;
  INSERT INTO application_status_email_queue (recipient_id, notification_ids) VALUES (c_player, ARRAY[v_id]);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'rejected' WHERE id = a2;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT max(metadata->>'status'), bool_and(emailed_at IS NOT NULL) INTO v_txt, v_ok FROM profile_notifications WHERE id = v_id;
  v_out := v_out || E'\n' || format('%s A7 shortlisted → rejected while its email batch waits → status %s, emailed_at kept %s',
    CASE WHEN v_txt = 'rejected' AND v_ok THEN 'PASS' ELSE 'FAIL' END, coalesce(v_txt, 'NULL'), coalesce(v_ok::text, 'NULL'));

  -- A8 server fallback offered → shortlisted (withdraw_offer / offer expiry shape) is silent.
  PERFORM public._set_application_status(a4, 'shortlisted');
  PERFORM public._set_application_status(a4, 'offered');
  PERFORM public._set_application_status(a4, 'shortlisted', 'recruiting_expiry');
  SELECT count(*) INTO v_n FROM profile_notifications
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a4;
  v_out := v_out || E'\n' || format('%s A8 offered → shortlisted by the server → %s message(s)',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- A9 a coach's role: the decline names the organisation, never the coach (sys write:
  -- the rule under test is the trigger's, whoever writes).
  UPDATE opportunity_applications SET status = 'rejected' WHERE id = a5;
  SELECT max(metadata->>'club_name') INTO v_txt FROM profile_notifications
   WHERE recipient_profile_id = c_player AND kind = 'vacancy_application_status' AND source_entity_id = a5;
  v_out := v_out || E'\n' || format('%s A9 coach role declined → club_name "%s" (organisation "%s")',
    CASE WHEN v_txt = c_org THEN 'PASS' ELSE 'FAIL' END, coalesce(v_txt, 'NULL'), c_org);

  -- @@B@@

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
