-- Probe for 20261003120000_get_my_week_viewers.sql: the owner-only
-- "Who looked at you" list for the player Pulse (Your week v2).
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
-- The three E2E accounts view the player: the club openly, the coach while
-- browsing anonymously, and a second player (the coach account is not a player,
-- so the player-viewer case uses the club account re-labelled as a player for
-- one assertion — all inside the rolled-back transaction).

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (owner)
  v_now    constant timestamptz := timezone('utc', now());
  v_n int; v_named int; v_masked int;
  v_row record;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  -- Real-account shape for the viewers (the fence drops test accounts), coach anonymous.
  UPDATE profiles SET is_test_account = false, browse_anonymously = false WHERE id = c_club;
  UPDATE profiles SET is_test_account = false, browse_anonymously = true  WHERE id = c_coach;
  DELETE FROM user_blocks WHERE (blocker_id = c_player AND blocked_id IN (c_club, c_coach))
                              OR (blocked_id = c_player AND blocker_id IN (c_club, c_coach));

  INSERT INTO events (event_name, entity_type, entity_id, user_id, role, created_at)
  VALUES ('profile_view', 'profile', c_player, c_club,  'club',  v_now - interval '2 days'),
         ('profile_view', 'profile', c_player, c_club,  'club',  v_now - interval '1 day'),
         ('profile_view', 'profile', c_player, c_coach, 'coach', v_now - interval '3 hours'),
         -- Old view, outside the 7-day window.
         ('profile_view', 'profile', c_player, c_club,  'club',  v_now - interval '20 days');

  -- A1 the owner sees the club by name, once (two views collapse to the latest)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM get_my_week_viewers(7);
  SELECT count(*) INTO v_named FROM get_my_week_viewers(7) v WHERE v.viewer_id = c_club AND v.full_name IS NOT NULL AND v.role = 'club' AND v.is_hidden = false;
  SELECT count(*) INTO v_masked FROM get_my_week_viewers(7) v WHERE v.is_hidden AND v.viewer_id IS NULL AND v.full_name IS NULL AND v.role IS NULL AND v.avatar_url IS NULL AND v.country_id IS NULL;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A1 owner sees the club once, by name → %s row(s), named club rows %s',
    CASE WHEN v_n = 2 AND v_named = 1 THEN 'PASS' ELSE 'FAIL' END, v_n, v_named);

  -- A2 the anonymous coach is a masked row (counted, never identified)
  v_out := v_out || E'\n' || format('%s A2 anonymous coach is masked → %s masked row(s)',
    CASE WHEN v_masked = 1 THEN 'PASS' ELSE 'FAIL' END, v_masked);

  -- A3 newest first: the coach (3h) before the club (1d)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT v.is_hidden INTO v_row FROM get_my_week_viewers(7) v LIMIT 1;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A3 newest first → first row hidden=%s', CASE WHEN v_row.is_hidden THEN 'PASS' ELSE 'FAIL' END, v_row.is_hidden);

  -- B1 a player who viewed is never listed (the club re-labelled as a player)
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE profiles SET role = 'player' WHERE id = c_club;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM get_my_week_viewers(7) v WHERE v.viewer_id = c_club;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE profiles SET role = 'club' WHERE id = c_club;
  v_out := v_out || E'\n' || format('%s B1 player viewers are absent → %s row(s) for the player-viewer', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B2 a test-account viewer is excluded
  UPDATE profiles SET is_test_account = true WHERE id = c_club;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM get_my_week_viewers(7) v WHERE v.viewer_id = c_club;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE profiles SET is_test_account = false WHERE id = c_club;
  v_out := v_out || E'\n' || format('%s B2 test-account viewer excluded → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B3 a blocked pair is excluded
  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_player, c_club);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM get_my_week_viewers(7) v WHERE v.viewer_id = c_club;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM user_blocks WHERE blocker_id = c_player AND blocked_id = c_club;
  v_out := v_out || E'\n' || format('%s B3 blocked viewer excluded → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B4 the window is honoured: 30 days includes the old view, 7 does not change the count
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM get_my_week_viewers(30);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B4 30-day window still one row per viewer → %s row(s)', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- C1 another signed-in user sees nothing of the player's viewers (own rows only)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM get_my_week_viewers(7) v WHERE v.viewer_id = c_club OR v.is_hidden;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s C1 another user sees none of the owner''s viewers → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- D1 anon cannot execute
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM count(*) FROM get_my_week_viewers(7);
    v_line := 'FAIL D1 anon executes get_my_week_viewers → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS D1 anon executes get_my_week_viewers → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
