-- Probe for 20260930200000_club_fit_category_cap.sql: fit respects the role's category.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration. Nothing is ever kept: the block ends by
-- raising 'PROBE RESULTS', which rolls back the whole statement (fixture roles and
-- the temporary category / position edits on the E2E player included).
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
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (recruits for a team)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  o_men_mid uuid; o_wom_mid uuid; o_mix_mid uuid; o_men_gk uuid; o_men_def uuid; o_men_nopos uuid; o_coach_gk uuid;
  r record;
  v_n int;
  v_out text := '';
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] cat · men midfielder', 'Dublin', 'Ireland', 'draft', 'midfielder', 'Men') RETURNING id INTO o_men_mid;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] cat · women midfielder', 'Dublin', 'Ireland', 'draft', 'midfielder', 'Women') RETURNING id INTO o_wom_mid;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] cat · mixed midfielder', 'Dublin', 'Ireland', 'draft', 'midfielder', 'Mixed') RETURNING id INTO o_mix_mid;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] cat · men goalkeeper', 'Dublin', 'Ireland', 'draft', 'goalkeeper', 'Men') RETURNING id INTO o_men_gk;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] cat · men defender', 'Dublin', 'Ireland', 'draft', 'defender', 'Men') RETURNING id INTO o_men_def;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, gender)
  VALUES (c_club, 'player', '[PROBE] cat · men no position', 'Dublin', 'Ireland', 'draft', 'Men') RETURNING id INTO o_men_nopos;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_coach, 'player', '[PROBE] cat · coach own goalkeeper', 'Dublin', 'Ireland', 'draft', 'goalkeeper', 'Men') RETURNING id INTO o_coach_gk;
  -- Strong other signals, so only category (or position) can hold a score back.
  UPDATE profiles SET position = 'midfielder', secondary_position = 'forward', playing_category = 'adult_women',
         open_to_play = true, last_active_at = now()
   WHERE id = c_player;

  -- A1 women's player on a MEN's role (primary position match) → no chip
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A1 adult_women vs Men''s midfielder role → %s %s gender=%s pos=%s',
    CASE WHEN r.state = 'grey' AND (r.components->>'gender_match')::numeric = 0 AND (r.components->>'position_match')::numeric = 1 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'gender_match', r.components->>'position_match');

  -- A2 same player on a WOMEN's role → green
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Women', NULL, o_wom_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A2 adult_women vs Women''s midfielder role → %s %s',
    CASE WHEN r.state = 'green' AND (r.components->>'gender_match')::numeric = 1 THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- A3 same player on a MIXED role → accepted (green)
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Mixed', NULL, o_mix_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A3 adult_women vs Mixed midfielder role → %s %s',
    CASE WHEN r.state = 'green' AND (r.components->>'gender_match')::numeric = 1 THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- A4 women's player, Men's role WITHOUT a position (old formula path) → still no chip
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_nopos);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A4 adult_women vs Men''s role (no position) → %s %s',
    CASE WHEN r.state = 'grey' AND NOT (r.components ? 'position_match') THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- A5 women's player, raw youth target Girls → accepted (same side); Boys → no chip
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Girls', NULL, o_wom_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A5a adult_women vs raw Girls target → %s %s gender=%s',
    CASE WHEN r.state <> 'grey' AND (r.components->>'gender_match')::numeric = 1 THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3), r.components->>'gender_match');
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Boys', NULL, o_men_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A5b adult_women vs raw Boys target → %s %s',
    CASE WHEN r.state = 'grey' THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- B1 men's player on a MEN's role → green
  UPDATE profiles SET playing_category = 'adult_men' WHERE id = c_player;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 adult_men vs Men''s midfielder role → %s %s',
    CASE WHEN r.state = 'green' THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- B2 men's player on a WOMEN's role → no chip
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Women', NULL, o_wom_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B2 adult_men vs Women''s midfielder role → %s %s',
    CASE WHEN r.state = 'grey' AND (r.components->>'gender_match')::numeric = 0 THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- B3 men's player on a MIXED role → accepted (green)
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Mixed', NULL, o_mix_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B3 adult_men vs Mixed midfielder role → %s %s',
    CASE WHEN r.state = 'green' THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- C1 round 5 still holds: midfielder vs goalkeeper role (right category) → no chip
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s C1 midfielder vs goalkeeper role → %s %s pos=%s',
    CASE WHEN r.state = 'grey' AND (r.components->>'position_match')::numeric = 0 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'position_match');

  -- C2 round 5: wrong OUTFIELD position → capped at Possible (never green, not forced grey)
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_def);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s C2 midfielder vs defender role → %s %s (≤0.65)',
    CASE WHEN r.state <> 'green' AND r.score <= 0.65 THEN 'PASS' ELSE 'FAIL' END, r.state, round(r.score, 3));

  -- C3 round 5: secondary position → Possible (yellow)
  UPDATE profiles SET position = 'defender', secondary_position = 'goalkeeper' WHERE id = c_player;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s C3 secondary goalkeeper vs goalkeeper role → %s %s pos=%s',
    CASE WHEN r.state = 'yellow' AND (r.components->>'position_match')::numeric = 0.5 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'position_match');

  -- D1 no playing category = honest absence: gender 0, but never capped to grey for that alone
  UPDATE profiles SET position = 'midfielder', secondary_position = NULL, playing_category = NULL WHERE id = c_player;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s D1 no category vs Men''s role → %s %s gender=%s (not capped)',
    CASE WHEN r.state <> 'grey' AND r.score > 0.39 AND (r.components->>'gender_match')::numeric = 0 THEN 'PASS' ELSE 'FAIL' END,
    r.state, round(r.score, 3), r.components->>'gender_match');

  -- E1 a coach who recruits gets a row for its OWN player role (goalkeeper, midfielder → grey)
  UPDATE profiles SET playing_category = 'adult_men' WHERE id = c_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit(c_coach, c_player, 'Men', NULL, o_coach_gk);
  SELECT * INTO r FROM compute_club_fit(c_coach, c_player, 'Men', NULL, o_coach_gk);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s E1 recruiting coach, own goalkeeper role → %s row, %s pos=%s',
    CASE WHEN v_n = 1 AND r.state = 'grey' AND r.components->>'role_position' = 'goalkeeper' THEN 'PASS' ELSE 'FAIL' END,
    v_n, r.state, r.components->>'position_match');

  -- F1 non-recruiter (the player asking about itself) → no row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit(c_player, c_player, 'Men', NULL, o_men_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s F1 non-recruiter → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- F2 club asking on behalf of another owner → no row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM compute_club_fit(c_coach, c_player, 'Men', NULL, o_men_mid);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s F2 caller ≠ owner → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- F3 anon cannot execute
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT count(*) INTO v_n FROM compute_club_fit(c_club, c_player, 'Men', NULL, o_men_mid);
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'FAIL F3 anon executed compute_club_fit';
  EXCEPTION WHEN insufficient_privilege THEN
    v_out := v_out || E'\n' || 'PASS F3 anon → permission denied';
  END;

  -- G1 grants / security model unchanged: postgres / authenticated / service_role, INVOKER, STABLE, search_path
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.proname = 'compute_club_fit'
     AND p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
     AND p.prosecdef = false AND p.provolatile = 's' AND p.proconfig::text LIKE '%search_path=public%';
  v_out := v_out || E'\n' || format('%s G1 grants/INVOKER/STABLE/search_path unchanged → %s', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- G2 the migration is recorded (it also cleared club_fit_cache)
  v_out := v_out || E'\n' || format('%s G2 migration recorded → %s', CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260930200000') THEN 'PASS' ELSE 'FAIL' END, '20260930200000');

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
