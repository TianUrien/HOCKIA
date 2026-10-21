-- Probe for 20261020180000_compute_club_fit_batch.sql: the batch wrapper
-- answers exactly what compute_club_fit answers, for exactly the same callers.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement (the draft fixture
-- role included).
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (recruiter)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  o_role uuid;
  r record;
  single record;
  v_n int;
  v_out text := '';
BEGIN
  -- ── fixture (sys): one draft role of the club ────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] fit batch', 'Dublin', 'Ireland', 'draft', 'midfielder', 'Men') RETURNING id INTO o_role;

  -- B1 as the club: one row per player id, equal to the single-player answer
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO single FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_role);
  SELECT count(*) INTO v_n FROM compute_club_fit_batch(c_club, ARRAY[c_player, c_coach], 'Men', NULL, o_role);
  SELECT * INTO r FROM compute_club_fit_batch(c_club, ARRAY[c_player, c_coach], 'Men', NULL, o_role) WHERE player_id = c_player;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 club batch of 2 → %s rows; player %s/%s vs single %s/%s',
    CASE WHEN v_n = 2 AND r.state = single.state AND r.score = single.score AND r.components = single.components THEN 'PASS' ELSE 'FAIL' END,
    v_n, r.state, round(r.score, 3), single.state, round(single.score, 3));

  -- B2 duplicate ids answer once each (one row per array element)
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit_batch(c_club, ARRAY[c_player, c_player], 'Men', NULL, o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B2 duplicate id → %s rows (one per element)', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B3 as the player (not a recruiter, not the owner): no rows, no error
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit_batch(c_club, ARRAY[c_player], 'Men', NULL, o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B3 player asking about the club → %s rows', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B4 as the club asking about another owner: no rows
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit_batch(c_coach, ARRAY[c_player], 'Men', NULL, o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B4 club asking as another owner → %s rows', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B5 anon cannot execute it at all
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM compute_club_fit_batch(c_club, ARRAY[c_player], 'Men', NULL, o_role);
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'FAIL B5 anon could execute compute_club_fit_batch';
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'PASS B5 anon → permission denied';
  END;

  -- B6 empty array → no rows, no error
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit_batch(c_club, ARRAY[]::uuid[], 'Men', NULL, o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B6 empty array → %s rows', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
