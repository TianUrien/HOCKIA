-- Probe for 20260930100000_club_fit_position.sql: fit counts position.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement (fixture roles and
-- the temporary position edits on the E2E player/coach included).
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT.
-- Fixture roles are drafts, so no publish side effects fire.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (recruiter)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (adult_men, open)
  o_gk uuid; o_mid uuid; o_def uuid; o_nopos uuid; o_head uuid;
  r record;
  v_n int;
  v_expected numeric;
  v_out text := '';
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] fit · goalkeeper', 'Dublin', 'Ireland', 'draft', 'goalkeeper', 'Men') RETURNING id INTO o_gk;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] fit · midfielder', 'Dublin', 'Ireland', 'draft', 'midfielder', 'Men') RETURNING id INTO o_mid;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] fit · defender', 'Dublin', 'Ireland', 'draft', 'defender', 'Men') RETURNING id INTO o_def;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, gender)
  VALUES (c_club, 'player', '[PROBE] fit · no position', 'Dublin', 'Ireland', 'draft', 'Men') RETURNING id INTO o_nopos;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'coach', '[PROBE] fit · head coach', 'Dublin', 'Ireland', 'draft', 'head_coach', 'Men') RETURNING id INTO o_head;
  -- Make the other signals strong, so only position can hold a score back.
  UPDATE profiles SET position = 'midfielder', secondary_position = 'forward', playing_category = 'adult_men',
         open_to_play = true, last_active_at = now()
   WHERE id = c_player;

  -- A1 midfielder (secondary forward) ranked for a GOALKEEPER role → not green (no chip)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A1 midfielder vs goalkeeper role → %s %s pos=%s',
    CASE WHEN r.state = 'grey' AND (r.components->>'position_match')::numeric = 0 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'position_match');

  -- A2 same player, midfielder role (primary match) → green
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A2 midfielder vs midfielder role → %s %s pos=%s',
    CASE WHEN r.state = 'green' AND (r.components->>'position_match')::numeric = 1 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'position_match');

  -- A3 wrong position on an OUTFIELD role (not required) → capped at Possible
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_def);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A3 midfielder vs defender role → %s %s (≤0.65)',
    CASE WHEN r.state <> 'green' AND r.score <= 0.65 THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- B1 goalkeeper vs goalkeeper role → green
  UPDATE profiles SET position = 'goalkeeper', secondary_position = NULL WHERE id = c_player;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 goalkeeper vs goalkeeper role → %s %s role=%s cand=%s',
    CASE WHEN r.state = 'green' AND r.components->>'role_position' = 'goalkeeper' AND r.components->>'candidate_position' = 'goalkeeper' THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'role_position', r.components->>'candidate_position');

  -- C1 secondary-position match → Possible at most (yellow), position_match 0.5
  UPDATE profiles SET position = 'defender', secondary_position = 'goalkeeper' WHERE id = c_player;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s C1 defender/secondary goalkeeper vs goalkeeper role → %s %s pos=%s',
    CASE WHEN r.state = 'yellow' AND (r.components->>'position_match')::numeric = 0.5 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'position_match');

  -- C2 no position on the profile → never green, never grey for that alone
  UPDATE profiles SET position = NULL, secondary_position = NULL WHERE id = c_player;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s C2 no position vs goalkeeper role → %s %s',
    CASE WHEN r.state = 'yellow' THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- D1 role without a position → old formula, no position keys
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_nopos);
  EXECUTE 'RESET ROLE';
  v_expected := LEAST(1, GREATEST(0, 0.40 * (r.components->>'competition_proximity')::numeric + 0.30 * (r.components->>'gender_match')::numeric
                  + 0.20 * (r.components->>'availability')::numeric + 0.10 * (r.components->>'recency')::numeric));
  v_out := v_out || E'\n' || format('%s D1 role with no position → %s %s (old formula %s, position key %s)',
    CASE WHEN r.score = v_expected AND NOT (r.components ? 'position_match') THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), round(v_expected, 3), CASE WHEN r.components ? 'position_match' THEN 'present' ELSE 'absent' END);

  -- E1 coach role: head coach specialisation vs head coach role → position_match 1
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_coach, 'Men', NULL, o_head);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s E1 head coach vs head coach role → %s %s pos=%s cand=%s',
    CASE WHEN (r.components->>'position_match')::numeric = 1 AND r.components->>'candidate_position' = 'head_coach' THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'position_match', r.components->>'candidate_position');

  -- E2 coach with another specialisation vs head coach role → never green
  UPDATE profiles SET coach_specialization = 'assistant_coach' WHERE id = c_coach;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_coach, 'Men', NULL, o_head);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s E2 assistant coach vs head coach role → %s %s pos=%s',
    CASE WHEN r.state <> 'green' AND (r.components->>'position_match')::numeric = 0 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'position_match');

  -- F1 non-recruiter (the player asking about itself) → no row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit(c_player, c_player, 'Men', NULL, o_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s F1 non-recruiter → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- F2 club asking on behalf of another owner → no row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit(c_coach, c_player, 'Men', NULL, o_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s F2 caller ≠ owner → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- F3 anon cannot execute
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT count(*) INTO v_n FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_gk);
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'FAIL F3 anon executed compute_club_fit';
  EXCEPTION WHEN insufficient_privilege THEN
    v_out := v_out || E'\n' || 'PASS F3 anon → permission denied';
  END;

  -- G1 grants are exactly postgres / authenticated / service_role
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.proname = 'compute_club_fit'
     AND p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
     AND p.prosecdef = false AND p.proconfig::text LIKE '%search_path=public%';
  v_out := v_out || E'\n' || format('%s G1 grants/search_path unchanged → %s', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
