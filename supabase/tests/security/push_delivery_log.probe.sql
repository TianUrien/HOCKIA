-- Probe for 20261123120000_push_delivery_log.sql: the push delivery log is
-- readable and writable by the service role only.
--
-- Run on STAGING only (the fixture id is the E2E player there), via the SQL
-- editor or MCP execute_sql, AFTER the migration. Nothing is ever kept: the
-- block ends by raising 'PROBE RESULTS', which rolls back the whole statement.
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.

DO $probe$
DECLARE
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  v_n int;
  v_out text := '';
  v_err text;
BEGIN
  -- ── fixture (sys): one row for the player ─────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO push_delivery_log (recipient_profile_id, kind, platform, outcome, detail)
  VALUES (c_player, 'message_received', 'ios', 'failed', 'APNs send failed: 500');

  -- A1 the member the row is about cannot read it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    SELECT count(*) INTO v_n FROM push_delivery_log;
    v_err := format('read %s row(s)', v_n);
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'permission denied';
  END;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A1 authenticated cannot read → %s',
    CASE WHEN v_err = 'permission denied' THEN 'PASS' ELSE 'FAIL' END, v_err);

  -- A2 a signed-in member cannot write a row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO push_delivery_log (recipient_profile_id, kind, platform, outcome)
    VALUES (c_player, 'message_received', 'web', 'sent');
    v_err := 'inserted';
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'permission denied';
  END;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A2 authenticated cannot write → %s',
    CASE WHEN v_err = 'permission denied' THEN 'PASS' ELSE 'FAIL' END, v_err);

  -- A3 a visitor cannot read it
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_n FROM push_delivery_log;
    v_err := format('read %s row(s)', v_n);
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'permission denied';
  END;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A3 anon cannot read → %s',
    CASE WHEN v_err = 'permission denied' THEN 'PASS' ELSE 'FAIL' END, v_err);

  -- A4 a member cannot run the retention function
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM prune_push_delivery_log();
    v_err := 'ran';
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'permission denied';
  END;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A4 authenticated cannot prune → %s',
    CASE WHEN v_err = 'permission denied' THEN 'PASS' ELSE 'FAIL' END, v_err);

  -- A5 the service role reads and writes
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    INSERT INTO push_delivery_log (recipient_profile_id, kind, platform, outcome)
    VALUES (c_player, 'message_received', 'android', 'sent');
    SELECT count(*) INTO v_n FROM push_delivery_log WHERE recipient_profile_id = c_player AND created_at > timezone('utc', now()) - interval '1 minute';
    v_err := format('%s row(s)', v_n);
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'permission denied'; v_n := 0;
  END;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A5 service role reads and writes → %s',
    CASE WHEN v_n >= 2 THEN 'PASS' ELSE 'FAIL' END, v_err);

  -- A6 retention removes rows older than 30 days and keeps recent ones
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO push_delivery_log (created_at, recipient_profile_id, kind, platform, outcome)
  VALUES (timezone('utc', now()) - interval '31 days', c_player, 'probe_old', 'web', 'sent');
  PERFORM prune_push_delivery_log();
  SELECT count(*) INTO v_n FROM push_delivery_log WHERE kind = 'probe_old';
  v_out := v_out || E'\n' || format('%s A6 rows older than 30 days are pruned → %s old row(s) left',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  SELECT count(*) INTO v_n FROM push_delivery_log WHERE recipient_profile_id = c_player AND kind = 'message_received';
  v_out := v_out || E'\n' || format('%s A7 recent rows survive pruning → %s row(s)',
    CASE WHEN v_n >= 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- A8 an unknown outcome is refused
  BEGIN
    INSERT INTO push_delivery_log (recipient_profile_id, kind, platform, outcome)
    VALUES (c_player, 'message_received', 'ios', 'delivered');
    v_err := 'inserted';
  EXCEPTION WHEN check_violation THEN v_err := 'check violation';
  END;
  v_out := v_out || E'\n' || format('%s A8 unknown outcome is refused → %s',
    CASE WHEN v_err = 'check violation' THEN 'PASS' ELSE 'FAIL' END, v_err);

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
