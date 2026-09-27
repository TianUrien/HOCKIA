-- Probe for 20260929200000_shortlist_per_role_unique.sql: a player on several
-- role shortlists of one club, never twice on the same list, and nobody else
-- can read or write a club's shortlist rows.
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

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (owner)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (another recruiter)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (the saved player)
  l_a uuid; l_b uuid; l_coach uuid;
  v_n int;
  v_txt text;
  v_out text := '';
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO shortlists (owner_id, name) VALUES (c_club, '[PROBE] Midfielder · Men') RETURNING id INTO l_a;
  INSERT INTO shortlists (owner_id, name) VALUES (c_club, '[PROBE] Defender · Men') RETURNING id INTO l_b;
  INSERT INTO shortlists (owner_id, name) VALUES (c_coach, '[PROBE] Coach list') RETURNING id INTO l_coach;

  -- S0 schema: owner+player unique gone, per-list unique present, NULL-list partial index present
  SELECT string_agg(conname, ',' ORDER BY conname) INTO v_txt FROM pg_constraint
   WHERE conrelid = 'public.saved_profiles'::regclass AND contype = 'u';
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'saved_profiles' AND indexname = 'saved_profiles_owner_player_no_list'
     AND indexdef LIKE '%WHERE (shortlist_id IS NULL)%';
  v_out := v_out || E'\n' || format('%s S0 unique constraints = %s · null-list partial index = %s',
    CASE WHEN v_txt = 'saved_profiles_shortlist_player_unique' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_txt, v_n);

  -- A1 the club puts the same player on two of its role lists
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO saved_profiles (owner_id, saved_profile_id, shortlist_id) VALUES (c_club, c_player, l_a);
  INSERT INTO saved_profiles (owner_id, saved_profile_id, shortlist_id) VALUES (c_club, c_player, l_b);
  SELECT count(*) INTO v_n FROM saved_profiles WHERE owner_id = c_club AND saved_profile_id = c_player AND shortlist_id IN (l_a, l_b);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A1 same player on two role lists → %s row(s)', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- A2 a duplicate on the same list is refused
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO saved_profiles (owner_id, saved_profile_id, shortlist_id) VALUES (c_club, c_player, l_a);
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'FAIL A2 duplicate on the same list → inserted';
  EXCEPTION WHEN unique_violation THEN
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'PASS A2 duplicate on the same list → refused (23505)';
  END;

  -- A3 removing from one list leaves the other
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  DELETE FROM saved_profiles WHERE owner_id = c_club AND saved_profile_id = c_player AND shortlist_id = l_a;
  SELECT count(*) INTO v_n FROM saved_profiles WHERE owner_id = c_club AND saved_profile_id = c_player AND shortlist_id IN (l_a, l_b);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A3 remove from one list keeps the other → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B1 another recruiter cannot read the club's rows
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM saved_profiles WHERE owner_id = c_club;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 other club/coach reads the club''s shortlist rows → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B2 … cannot insert a row owned by the club
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO saved_profiles (owner_id, saved_profile_id, shortlist_id) VALUES (c_club, c_player, l_a);
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'FAIL B2 insert a row owned by the club → inserted';
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'PASS B2 insert a row owned by the club → refused (RLS)';
  END;

  -- B3 … cannot point its own row at the club's list
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO saved_profiles (owner_id, saved_profile_id, shortlist_id) VALUES (c_coach, c_player, l_a);
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'FAIL B3 own row on the club''s list → inserted';
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'PASS B3 own row on the club''s list → refused (list owner guard)';
  END;

  -- B4 … cannot move its own row onto the club's list
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO saved_profiles (owner_id, saved_profile_id, shortlist_id) VALUES (c_coach, c_player, l_coach);
  EXECUTE 'RESET ROLE';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE saved_profiles SET shortlist_id = l_b WHERE owner_id = c_coach AND shortlist_id = l_coach;
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'FAIL B4 move own row onto the club''s list → updated';
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'PASS B4 move own row onto the club''s list → refused (list owner guard)';
  END;

  -- B5 … cannot update or delete the club's rows (silently 0 rows)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE saved_profiles SET note = 'probe' WHERE owner_id = c_club;
  DELETE FROM saved_profiles WHERE owner_id = c_club;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_n FROM saved_profiles WHERE owner_id = c_club AND shortlist_id = l_b AND note IS DISTINCT FROM 'probe';
  v_out := v_out || E'\n' || format('%s B5 other club/coach update+delete on the club''s rows → club row intact (%s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B6 anon reads nothing
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_n FROM saved_profiles WHERE owner_id = c_club;
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || format('%s B6 anon reads the club''s rows → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || 'PASS B6 anon reads the club''s rows → permission denied';
  END;

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
