-- Probe for 20261003100000_signing_switches_current_club.sql: a signing confirmed
-- through Hockia switches the current club on the start date.
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
-- The cron is simulated by moving a future row's start date to today (sys) and
-- calling the sweep the job runs.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (control row)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (signs)
  v_today  constant date := timezone('utc', now())::date;
  o_today uuid; o_future uuid; a_today uuid; a_future uuid;
  ch_today uuid; ch_future uuid; ch_manual uuid;
  v_club_world uuid;
  v_before record; v_coach_before timestamptz;
  v_after record;
  v_n int; v_b boolean; v_j jsonb;
  v_txt text;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT current_club, current_world_club_id, updated_at INTO v_before FROM profiles WHERE id = c_player;
  SELECT updated_at INTO v_coach_before FROM profiles WHERE id = c_coach;
  SELECT current_world_club_id INTO v_club_world FROM profiles WHERE id = c_club;

  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status,
                             start_date, organization_name)
  VALUES (c_club, 'player', '[PROBE] signing · starts today', 'Dublin', 'Ireland', 'open',
          v_today, '[PROBE] Today FC') RETURNING id INTO o_today;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status,
                             start_date, organization_name)
  VALUES (c_club, 'player', '[PROBE] signing · starts later', 'Dublin', 'Ireland', 'open',
          v_today + 7, '[PROBE] Future FC') RETURNING id INTO o_future;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signing_requested_at, signing_close_role)
  VALUES (o_today, c_player, 'signed_pending_confirmation', timezone('utc', now()), false) RETURNING id INTO a_today;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signing_requested_at, signing_close_role)
  VALUES (o_future, c_player, 'signed_pending_confirmation', timezone('utc', now()), false) RETURNING id INTO a_future;

  -- A1 the player confirms a signing that starts today → current club switches now
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (confirm_signing(a_today, false) ->> 'career_entry_id')::uuid INTO ch_today;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT current_club, current_world_club_id, updated_at INTO v_after FROM profiles WHERE id = c_player;
  SELECT current_club_applied INTO v_b FROM career_history WHERE id = ch_today;
  v_txt := format('club %s → %s, world %s, applied=%s',
                  coalesce(v_before.current_club, 'NULL'), coalesce(v_after.current_club, 'NULL'),
                  CASE WHEN v_after.current_world_club_id = v_club_world THEN 'the club''s' ELSE coalesce(v_after.current_world_club_id::text, 'NULL') END,
                  v_b);
  v_out := v_out || E'\n' || format('%s A1 confirm, start today → %s',
    CASE WHEN v_after.current_club = '[PROBE] Today FC' AND v_after.current_world_club_id = v_club_world AND v_b THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- A2 set_profiles_updated_at ran for that single row; the coach's row is untouched
  v_txt := format('player updated_at moved=%s, coach moved=%s',
                  v_after.updated_at > v_before.updated_at,
                  (SELECT updated_at FROM profiles WHERE id = c_coach) IS DISTINCT FROM v_coach_before);
  v_out := v_out || E'\n' || format('%s A2 updated_at trigger on the single row → %s',
    CASE WHEN v_after.updated_at > v_before.updated_at
          AND (SELECT updated_at FROM profiles WHERE id = c_coach) IS NOT DISTINCT FROM v_coach_before THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- A3 idempotent: applying the same row again is a no-op
  SELECT _apply_signing_current_club(ch_today) INTO v_b;
  v_out := v_out || E'\n' || format('%s A3 helper on an applied row → returns %s, club %s',
    CASE WHEN v_b = false AND (SELECT current_club FROM profiles WHERE id = c_player) = '[PROBE] Today FC' THEN 'PASS' ELSE 'FAIL' END,
    v_b, (SELECT current_club FROM profiles WHERE id = c_player));

  -- B1 the player confirms a signing that starts in a week → nothing switches yet
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (confirm_signing(a_future, false) ->> 'career_entry_id')::uuid INTO ch_future;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT current_club_applied INTO v_b FROM career_history WHERE id = ch_future;
  v_txt := format('club %s, applied=%s, start %s', (SELECT current_club FROM profiles WHERE id = c_player), v_b,
                  (SELECT start_date FROM career_history WHERE id = ch_future));
  v_out := v_out || E'\n' || format('%s B1 confirm, start in 7 days → %s',
    CASE WHEN (SELECT current_club FROM profiles WHERE id = c_player) = '[PROBE] Today FC' AND v_b = false THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- B2 the sweep before the start date leaves it alone. (Other due signings on
  -- staging may legitimately be applied by this call — the sweep also catches
  -- missed earlier rows — so only this row and its club are asserted.)
  SELECT apply_due_signing_current_clubs() INTO v_j;
  SELECT current_club_applied INTO v_b FROM career_history WHERE id = ch_future;
  v_out := v_out || E'\n' || format('%s B2 sweep before the start date → club %s, applied=%s, sweep %s',
    CASE WHEN (SELECT current_club FROM profiles WHERE id = c_player) <> '[PROBE] Future FC' AND v_b = false THEN 'PASS' ELSE 'FAIL' END,
    (SELECT current_club FROM profiles WHERE id = c_player), v_b, v_j::text);

  -- B3 the start date arrives (sys moves it to today) and the daily sweep switches the club
  UPDATE career_history SET start_date = v_today WHERE id = ch_future;
  SELECT apply_due_signing_current_clubs() INTO v_j;
  SELECT current_club, current_world_club_id INTO v_after FROM profiles WHERE id = c_player;
  SELECT current_club_applied INTO v_b FROM career_history WHERE id = ch_future;
  v_out := v_out || E'\n' || format('%s B3 sweep on the start date → club %s, applied=%s, sweep %s',
    CASE WHEN v_after.current_club = '[PROBE] Future FC' AND v_b THEN 'PASS' ELSE 'FAIL' END,
    coalesce(v_after.current_club, 'NULL'), v_b, v_j::text);

  -- C1 a career entry the player typed (not a signing) never switches anything
  INSERT INTO career_history (user_id, club_name, position_role, years, division_league, start_date)
  VALUES (c_player, '[PROBE] Manual Club', 'Midfielder', '2026–27', '', v_today) RETURNING id INTO ch_manual;
  SELECT _apply_signing_current_club(ch_manual) INTO v_b;
  SELECT apply_due_signing_current_clubs() INTO v_j;
  v_txt := format('helper=%s, club %s, applied=%s', v_b, (SELECT current_club FROM profiles WHERE id = c_player),
                  (SELECT current_club_applied FROM career_history WHERE id = ch_manual));
  v_out := v_out || E'\n' || format('%s C1 non-signing row → %s',
    CASE WHEN v_b = false AND (SELECT current_club FROM profiles WHERE id = c_player) = '[PROBE] Future FC'
          AND (SELECT current_club_applied FROM career_history WHERE id = ch_manual) = false THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- D1 anon cannot execute the helper
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM _apply_signing_current_club(ch_today);
    v_line := 'FAIL D1 anon executes _apply_signing_current_club → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS D1 anon executes _apply_signing_current_club → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D2 a signed-in member cannot execute the helper
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM _apply_signing_current_club(ch_today);
    v_line := 'FAIL D2 authenticated executes _apply_signing_current_club → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS D2 authenticated executes _apply_signing_current_club → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D3 a signed-in member cannot run the sweep
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM apply_due_signing_current_clubs();
    v_line := 'FAIL D3 authenticated executes apply_due_signing_current_clubs → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS D3 authenticated executes apply_due_signing_current_clubs → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E1 the applied flag is server-owned: a direct client write cannot clear it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE career_history SET current_club_applied = false, description = 'probe' WHERE id = ch_today;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT current_club_applied INTO v_b FROM career_history WHERE id = ch_today;
  v_out := v_out || E'\n' || format('%s E1 client clears the applied flag → %s row(s) written, flag=%s',
    CASE WHEN v_b THEN 'PASS' ELSE 'FAIL' END, v_n, v_b);

  -- F1 the daily job exists and runs the sweep
  SELECT count(*) INTO v_n FROM cron.job
   WHERE jobname = 'signing_current_club_daily' AND active AND command LIKE '%apply_due_signing_current_clubs()%';
  v_out := v_out || E'\n' || format('%s F1 cron signing_current_club_daily → %s job(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
