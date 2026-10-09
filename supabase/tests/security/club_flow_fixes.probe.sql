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
  v_n int; v_txt text; v_txt2 text; v_id uuid; v_ok boolean;
  v_p uuid[];
  o6 uuid; o7 uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid; b6 uuid; b7 uuid; b8 uuid; l1 uuid; l2 uuid;
  f4 uuid; f5 uuid; f6 uuid;
  o8 uuid; o9 uuid; o10 uuid;
  v_line text; v_state text;
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

  -- ══ B · reopening a role closed as filled gives its applicants back ══════════
  -- Seven other players apply to one role (sys inserts, any state); the E2E player
  -- is the signed one. The roles set no gender and no EU rule, so eligibility never refuses.
  SELECT array_agg(id) INTO v_p FROM (
    SELECT id FROM profiles WHERE role = 'player' AND id <> c_player ORDER BY created_at, id LIMIT 7) x;
  IF coalesce(array_length(v_p, 1), 0) < 7 THEN
    v_out := v_out || E'\n' || format('FAIL B0 fixtures → only %s other players on this database', coalesce(array_length(v_p, 1), 0));
  ELSE
    INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
    VALUES (c_club, 'player', '[PROBE] club flow · fill and reopen', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o6;

    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o6, v_p[1], 'pending') RETURNING id INTO b1;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o6, v_p[2], 'shortlisted') RETURNING id INTO b2;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, metadata)
    VALUES (o6, v_p[3], 'maybe', '{"status_reason": "timing"}'::jsonb) RETURNING id INTO b3;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o6, v_p[4], 'offered') RETURNING id INTO b4;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o6, v_p[5], 'offered') RETURNING id INTO b5;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o6, v_p[6], 'accepted') RETURNING id INTO b6;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o6, v_p[7], 'rejected') RETURNING id INTO b7;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signed_at)
    VALUES (o6, c_player, 'signed', timezone('utc', now())) RETURNING id INTO b8;
    INSERT INTO opportunity_offers (application_id, opportunity_id, club_id, player_id, version, open_until)
    VALUES (b4, o6, c_club, v_p[4], 1, v_today + 10) RETURNING id INTO f4;
    INSERT INTO opportunity_offers (application_id, opportunity_id, club_id, player_id, version, open_until)
    VALUES (b5, o6, c_club, v_p[5], 1, v_today) RETURNING id INTO f5;
    INSERT INTO opportunity_offers (application_id, opportunity_id, club_id, player_id, version, open_until, status)
    VALUES (b6, o6, c_club, v_p[6], 1, v_today + 10, 'accepted') RETURNING id INTO f6;

    -- Close as filled, as the club (closeRolePatch).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunities SET status = 'closed', closed_reason = 'filled' WHERE id = o6;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT string_agg(format('%s:%s<-%s', x.k, a.status, coalesce(a.metadata->'before_filled'->>'status', '-')), ' ' ORDER BY x.k),
           bool_and(CASE WHEN x.k <= 6 THEN a.status::text = 'filled' AND a.metadata->>'changed_via' = 'role_filled'
                                            AND a.metadata->'before_filled'->>'status' = x.before
                         ELSE a.status::text = x.before END)
      INTO v_txt, v_ok
      FROM (VALUES (1, b1, 'pending'), (2, b2, 'shortlisted'), (3, b3, 'maybe'), (4, b4, 'offered'),
                   (5, b5, 'offered'), (6, b6, 'accepted'), (7, b7, 'rejected'), (8, b8, 'signed')) AS x(k, id, before)
      JOIN opportunity_applications a ON a.id = x.id;
    v_out := v_out || E'\n' || format('%s B1 close as filled → waiting ones filled with the previous status recorded, rejected / signed untouched → %s',
      CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_txt);
    SELECT string_agg(status, ',' ORDER BY version) INTO v_txt FROM opportunity_offers WHERE id IN (f4, f5);
    v_out := v_out || E'\n' || format('%s B2 the live offers were cancelled by the fill → %s',
      CASE WHEN (SELECT bool_and(status = 'cancelled') FROM opportunity_offers WHERE id IN (f4, f5)) THEN 'PASS' ELSE 'FAIL' END, v_txt);

    -- Time passes: f5's open-until date is now behind us.
    UPDATE opportunity_offers SET open_until = v_today - 1 WHERE id = f5;

    -- Reopen, as the club (reopenRolePatch).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunities
       SET status = 'open', closed_reason = NULL, filled_via_hockia = NULL, auto_closed_at = NULL, closed_at = NULL
     WHERE id = o6;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT string_agg(format('%s:%s', x.k, a.status), ' ' ORDER BY x.k),
           bool_and(a.status::text = x.want AND NOT (a.metadata ? 'before_filled') AND NOT (a.metadata ? 'changed_via'))
      INTO v_txt, v_ok
      FROM (VALUES (1, b1, 'pending'), (2, b2, 'shortlisted'), (3, b3, 'maybe'), (4, b4, 'offered'),
                   (5, b5, 'shortlisted'), (6, b6, 'accepted'), (7, b7, 'rejected'), (8, b8, 'signed')) AS x(k, id, want)
      JOIN opportunity_applications a ON a.id = x.id;
    v_out := v_out || E'\n' || format('%s B3 reopen → exact previous statuses (out-of-date offer → shortlisted), signed stays signed → %s',
      CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_txt);

    SELECT metadata->>'status_reason' INTO v_txt FROM opportunity_applications WHERE id = b3;
    v_out := v_out || E'\n' || format('%s B4 the club''s reason code comes back with Maybe → %s',
      CASE WHEN v_txt = 'timing' THEN 'PASS' ELSE 'FAIL' END, coalesce(v_txt, 'NULL'));

    SELECT format('f4=%s f5=%s f6=%s', (SELECT status FROM opportunity_offers WHERE id = f4),
                  (SELECT status FROM opportunity_offers WHERE id = f5), (SELECT status FROM opportunity_offers WHERE id = f6))
      INTO v_txt;
    v_out := v_out || E'\n' || format('%s B5 the in-date offer is live again, the out-of-date one stays cancelled, the accepted one untouched → %s',
      CASE WHEN v_txt = 'f4=live f5=cancelled f6=accepted' THEN 'PASS' ELSE 'FAIL' END, v_txt);

    -- No new message for the restored players; the stale "role filled" one is cleared.
    SELECT count(*) FILTER (WHERE pn.cleared_at IS NULL) INTO v_n
      FROM profile_notifications pn
     WHERE pn.kind = 'vacancy_application_status' AND pn.source_entity_id IN (b1, b2, b3, b4, b5, b6);
    v_out := v_out || E'\n' || format('%s B6 restored players: %s visible message(s) about these applications after reopen',
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

    SELECT count(*) INTO v_n FROM application_status_history h
     WHERE h.application_id IN (b1, b2, b3, b4, b5, b6) AND h.old_status::text = 'filled';
    v_out := v_out || E'\n' || format('%s B7 one history row per restore (old_status filled) → %s of 6',
      CASE WHEN v_n = 6 THEN 'PASS' ELSE 'FAIL' END, v_n);

    -- Legacy fills (before this migration): no before_filled. With the fill's history
    -- row → its old_status; with nothing recorded → pending.
    INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
    VALUES (c_club, 'player', '[PROBE] club flow · legacy fill', 'Dublin', 'Ireland', 'open', v_today) RETURNING id INTO o7;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o7, v_p[1], 'shortlisted') RETURNING id INTO l1;
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o7, v_p[2], 'maybe') RETURNING id INTO l2;
    UPDATE opportunities SET status = 'closed', closed_reason = 'withdrawn' WHERE id = o7;
    -- Old fill shape: status + changed_via only (as 20261004200000 wrote it).
    UPDATE opportunity_applications SET status = 'filled', metadata = '{"changed_via": "role_filled"}'::jsonb WHERE id IN (l1, l2);
    DELETE FROM application_status_history WHERE application_id = l2;   -- l2: nothing recorded
    UPDATE opportunities SET status = 'open', closed_reason = NULL, closed_at = NULL WHERE id = o7;
    SELECT format('l1=%s l2=%s', (SELECT status FROM opportunity_applications WHERE id = l1),
                  (SELECT status FROM opportunity_applications WHERE id = l2)) INTO v_txt;
    v_out := v_out || E'\n' || format('%s B8 legacy fills on reopen: from history → shortlisted, nothing recorded → pending → %s',
      CASE WHEN v_txt = 'l1=shortlisted l2=pending' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  END IF;

  -- ══ C · a role with a signing can't be deleted ═══════════════════════════════
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] club flow · signed', 'Dublin', 'Ireland', 'closed', v_today) RETURNING id INTO o8;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] club flow · waiting to confirm', 'Dublin', 'Ireland', 'closed', v_today) RETURNING id INTO o9;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, start_date)
  VALUES (c_club, 'player', '[PROBE] club flow · no signing', 'Dublin', 'Ireland', 'closed', v_today) RETURNING id INTO o10;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signed_at)
  VALUES (o8, c_player, 'signed', timezone('utc', now()));
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signing_requested_at, signing_close_role)
  VALUES (o9, c_player, 'signed_pending_confirmation', timezone('utc', now()), true);
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o10, c_player, 'rejected');

  -- C1 / C2 the club deletes a role with a signing → refused with the founder sentence.
  FOR v_id, v_txt IN SELECT * FROM (VALUES (o8, 'C1 signed'), (o9, 'C2 waiting to confirm')) AS x(id, label) LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      DELETE FROM opportunities WHERE id = v_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_line := format('FAIL %s: the club deletes the role → deleted %s row(s)', v_txt, v_n);
      RAISE EXCEPTION 'probe_undo';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_txt2 = PG_EXCEPTION_DETAIL;
      IF SQLERRM <> 'probe_undo' THEN
        v_line := format('%s %s: the club deletes the role → %s %s (%s)',
          CASE WHEN v_state = 'P0001' AND SQLERRM = 'This role has a confirmed signing, so it can''t be deleted. Close it instead.'
                    AND v_txt2 = 'role_has_signing' THEN 'PASS' ELSE 'FAIL' END,
          v_txt, v_state, SQLERRM, coalesce(v_txt2, ''));
      END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    v_out := v_out || E'\n' || v_line;
  END LOOP;

  -- C3 every caller: the owner (service role / admin paths) is refused too.
  BEGIN
    DELETE FROM opportunities WHERE id = o8;
    v_line := 'FAIL C3 sys deletes a role with a signing → deleted';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN
      v_line := format('%s C3 sys deletes a role with a signing → %s', CASE WHEN SQLSTATE = 'P0001' THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  SELECT count(*) INTO v_n FROM opportunity_applications WHERE opportunity_id IN (o8, o9);
  v_out := v_out || E'\n' || format('%s C4 the refused roles keep their signings → %s of 2',
    CASE WHEN v_n = 2 AND (SELECT count(*) FROM opportunities WHERE id IN (o8, o9)) = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- C5 a role without a signing is still deleted by the club (undone afterwards).
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    DELETE FROM opportunities WHERE id = o10;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('%s C5 the club deletes a closed role without a signing → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C5 the club deletes a closed role without a signing → ' || SQLERRM; END IF;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || v_line;

  -- C6 account deletion (hard_delete_profile_relations sets this marker) lets the
  -- publisher's roles go, signing or not. Another profile's marker does not.
  BEGIN
    PERFORM set_config('hockia.deleting_profile', c_coach::text, true);
    DELETE FROM opportunities WHERE id = o8;
    v_line := 'FAIL C6a another profile''s deletion marker → deleted';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN
      v_line := format('%s C6a another profile''s deletion marker → %s', CASE WHEN SQLSTATE = 'P0001' THEN 'PASS' ELSE 'FAIL' END, SQLERRM);
    END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  BEGIN
    PERFORM set_config('hockia.deleting_profile', c_club::text, true);
    DELETE FROM opportunities WHERE id = o8;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('%s C6b the publisher deletes their account → role deleted (%s row)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C6b the publisher deletes their account → ' || SQLERRM; END IF;
  END;
  PERFORM set_config('hockia.deleting_profile', '', true);
  v_out := v_out || E'\n' || v_line;


  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
