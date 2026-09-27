-- Probe for 20260929100000_open_roles_hidden_club_fence.sql: who can read an open role.
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
  o_open uuid; o_applied uuid;
  v_n int;
  v_txt text;
  v_out text := '';
  v_line text;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] open fence · open', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_open;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] open fence · applied', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_applied;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
  VALUES (o_applied, c_player, 'pending');
  DELETE FROM user_blocks
   WHERE (blocker_id IN (c_player, c_coach) AND blocked_id = c_club)
      OR (blocker_id = c_club AND blocked_id IN (c_player, c_coach));

  -- A1 control: anon, player and coach read an open role
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
  EXECUTE 'RESET ROLE';
  v_txt := 'anon=' || v_n;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
  EXECUTE 'RESET ROLE';
  v_txt := v_txt || ' player=' || v_n;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
  EXECUTE 'RESET ROLE';
  v_txt := v_txt || ' coach=' || v_n;
  v_out := v_out || E'\n' || format('%s A1 open role visible to everyone → %s',
    CASE WHEN v_txt = 'anon=1 player=1 coach=1' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- A2 control: a member reads it through public_opportunities too (the view hides test /
  --    not-onboarded publishers, so the expected count follows the E2E club's flags).
  --    Guests never query the view directly: the public-opportunities edge fn and the
  --    sitemap read it with the service role.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public_opportunities WHERE id = o_open;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A2 member reads public_opportunities (0 if the E2E club is a test account) → %s row(s)',
    CASE WHEN v_n = (SELECT CASE WHEN coalesce(is_test_account, false) OR NOT onboarding_completed THEN 0 ELSE 1 END FROM profiles WHERE id = c_club)
      THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- A3 control: a member still reads every real open role through the view
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public_opportunities;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_line FROM opportunities o JOIN profiles p ON p.id = o.club_id
   WHERE o.status = 'open' AND coalesce(p.is_test_account, false) = false AND p.onboarding_completed = true
     AND NOT profile_is_hidden(p.is_blocked, p.frozen_minor_at);
  v_out := v_out || E'\n' || format('%s A3 member public_opportunities count matches sys count → member=%s sys=%s',
    CASE WHEN v_n::text = v_line THEN 'PASS' ELSE 'FAIL' END, v_n, v_line);
  v_line := NULL;

  -- B1 (undo) hidden publisher (blocked by admin) → anon, player, coach read 0; owner still reads it
  BEGIN
    UPDATE profiles SET is_blocked = true WHERE id = c_club;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := 'anon=' || v_n;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || ' coach=' || v_n;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || ' owner=' || v_n;
    v_line := format('%s B1 publisher hidden (blocked) → %s', CASE WHEN v_txt = 'anon=0 coach=0 owner=1' THEN 'PASS' ELSE 'FAIL' END, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B1 hidden publisher → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B2 (undo) frozen publisher → anon and coach read 0
  BEGIN
    UPDATE profiles SET frozen_minor_at = now() WHERE id = c_club;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := 'anon=' || v_n;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || ' coach=' || v_n;
    v_line := format('%s B2 publisher hidden (frozen) → %s', CASE WHEN v_txt = 'anon=0 coach=0' THEN 'PASS' ELSE 'FAIL' END, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B2 frozen publisher → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C1 (undo) blocked pair, both directions → the blocked viewer reads 0; a third member and anon still read it
  BEGIN
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_coach, c_club);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := 'coach blocked club → ' || v_n;
    DELETE FROM user_blocks WHERE blocker_id = c_coach AND blocked_id = c_club;
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_club, c_coach);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || '; club blocked coach → ' || v_n;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || '; other member → ' || v_n;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || '; anon → ' || v_n;
    v_line := format('%s C1 blocked pair → %s',
      CASE WHEN v_txt = 'coach blocked club → 0; club blocked coach → 0; other member → 1; anon → 1' THEN 'PASS' ELSE 'FAIL' END, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C1 blocked pair → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C2 (undo) an applicant who then blocked the club keeps reading the role they applied to
  --          (applicant policy, unchanged), but not the club's other open roles
  BEGIN
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_player, c_club);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_applied;
    v_txt := 'applied=' || v_n;
    SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
    EXECUTE 'RESET ROLE';
    v_txt := v_txt || ' other=' || v_n;
    v_line := format('%s C2 applicant after block → %s', CASE WHEN v_txt = 'applied=1 other=0' THEN 'PASS' ELSE 'FAIL' END, v_txt);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C2 applicant after block → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D1 helper ACL: anon + authenticated can execute (the policy runs as the caller), PUBLIC cannot
  SELECT format('anon=%s authenticated=%s public=%s',
      has_function_privilege('anon', 'public.viewer_can_view_open_opportunity(uuid)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.viewer_can_view_open_opportunity(uuid)', 'EXECUTE'),
      coalesce((SELECT bool_or(a.grantee = 0) FROM pg_proc p, aclexplode(p.proacl) a
                 WHERE p.oid = 'public.viewer_can_view_open_opportunity(uuid)'::regprocedure), false))
    INTO v_txt;
  v_out := v_out || E'\n' || format('%s D1 helper grants → %s',
    CASE WHEN v_txt = 'anon=t authenticated=t public=f' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- D2 policy shape: still the only open-role read, SELECT-only, open rows only
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'opportunities' AND policyname = 'Public can view open opportunities'
     AND cmd = 'SELECT' AND qual LIKE '%''open''::opportunity_status%' AND qual LIKE '%viewer_can_view_open_opportunity%';
  v_out := v_out || E'\n' || format('%s D2 open-role policy is SELECT-only, open-only, fenced → %s match', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- D3 control after undo: everyone reads it again
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunities WHERE id = o_open;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s D3 control after undo → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
