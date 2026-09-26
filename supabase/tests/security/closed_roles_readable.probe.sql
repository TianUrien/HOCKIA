-- Probe for 20260928260000_closed_roles_readable.sql: who can read a closed role.
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
-- Cases marked (undo) run in a sub-transaction that is always rolled back.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (another member)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  c_qa_closed constant uuid := 'f9a4329e-7ab4-4fb7-ba47-c8c63cd563b4'; -- "[QA] Girls head coach" (closed, no applicants)
  o_open uuid; o_closed uuid; o_draft uuid;
  v_n int;
  v_txt text;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] closed read · open', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_open;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] closed read · closed', 'Dublin', 'Ireland', 'closed') RETURNING id INTO o_closed;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] closed read · draft', 'Dublin', 'Ireland', 'draft') RETURNING id INTO o_draft;
  DELETE FROM user_blocks
   WHERE (blocker_id = c_player AND blocked_id = c_club) OR (blocker_id = c_club AND blocked_id = c_player);

  -- A1 signed-in non-applicant reads a closed role
  SELECT count(*) INTO v_n FROM opportunity_applications WHERE opportunity_id = o_closed AND applicant_id = c_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_txt FROM opportunities WHERE id = o_closed;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A1 signed-in non-applicant (applications=%s) reads a closed role → %s row(s)',
    CASE WHEN v_n = 0 AND v_txt = '1' THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);

  -- A2 the real QA closed role, with the detail page's club join, for a non-applicant
  SELECT count(*) INTO v_n FROM opportunity_applications WHERE opportunity_id = c_qa_closed AND applicant_id = c_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT coalesce(max(o.status::text || ' · club ' || coalesce(p.full_name, 'NULL')), 'no row') INTO v_txt
    FROM opportunities o LEFT JOIN profiles p ON p.id = o.club_id WHERE o.id = c_qa_closed;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A2 "[QA] Girls head coach" (applications=%s) with club join → %s',
    CASE WHEN v_n = 0 AND v_txt LIKE 'closed · club %' AND v_txt NOT LIKE '%NULL' THEN 'PASS' ELSE 'FAIL' END, v_n, v_txt);

  -- A3 another member (coach) reads it too
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_closed;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A3 coach reads a closed role → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B1 anon cannot read a closed role (fixture and the real QA one)
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_n FROM opportunities WHERE id IN (o_closed, c_qa_closed);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 anon reads closed roles → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B2 control: anon still reads an open role
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B2 anon reads an open role (unchanged) → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B3 anon cannot call the helper
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM member_can_view_closed_opportunity(c_club);
    v_line := 'FAIL B3 anon executes member_can_view_closed_opportunity → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS B3 anon executes member_can_view_closed_opportunity → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C1 a draft: player and coach cannot read it, anon cannot, the owner can
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_draft;
  EXECUTE 'RESET ROLE';
  v_txt := 'player=' || v_n;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_draft;
  EXECUTE 'RESET ROLE';
  v_txt := v_txt || ' coach=' || v_n;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_draft;
  EXECUTE 'RESET ROLE';
  v_txt := v_txt || ' anon=' || v_n;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_draft;
  EXECUTE 'RESET ROLE';
  v_txt := v_txt || ' owner=' || v_n;
  v_out := v_out || E'\n' || format('%s C1 draft visibility → %s',
    CASE WHEN v_txt = 'player=0 coach=0 anon=0 owner=1' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- C2 the new policy's shape: signed-in, read-only, closed rows only (never drafts).
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'opportunities' AND policyname = 'Members can view closed opportunities'
     AND roles = '{authenticated}' AND cmd = 'SELECT' AND qual LIKE '%''closed''::opportunity_status%' AND qual NOT LIKE '%draft%';
  v_out := v_out || E'\n' || format('%s C2 new policy is authenticated-only, SELECT-only, closed-only → %s match', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- D1 (undo) a hidden publisher (blocked by admin) hides its closed roles
  BEGIN
    UPDATE profiles SET is_blocked = true WHERE id = c_club;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id IN (o_closed, c_qa_closed);
    EXECUTE 'RESET ROLE';
    v_line := format('%s D1 publisher hidden (blocked) → member reads %s closed row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D1 hidden publisher → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D2 (undo) a frozen publisher hides its closed roles
  BEGIN
    UPDATE profiles SET frozen_minor_at = now() WHERE id = c_club;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id IN (o_closed, c_qa_closed);
    EXECUTE 'RESET ROLE';
    v_line := format('%s D2 publisher hidden (frozen) → member reads %s closed row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D2 frozen publisher → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D3 (undo) viewer and publisher blocked each other → closed role hidden (both directions)
  BEGIN
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_player, c_club);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_closed;
    EXECUTE 'RESET ROLE';
    v_txt := 'player blocked club → ' || v_n;
    DELETE FROM user_blocks WHERE blocker_id = c_player AND blocked_id = c_club;
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_club, c_player);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_closed;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || '; club blocked player → ' || v_n;
    v_line := format('%s D3 blocked pair → %s', CASE WHEN v_txt LIKE '%→ 0; %→ 0' THEN 'PASS' ELSE 'FAIL' END, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D3 blocked pair → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D4 control: the same member reads it again once nothing is hidden
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id IN (o_closed, c_qa_closed);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s D4 control after undo → %s closed row(s)', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
