-- Probe for 20261002200000: a publisher can READ a withdrawn application to
-- its own role, still cannot change it, and other clubs / anon see nothing.
-- Run on STAGING only (fixture ids are the E2E accounts there) via execute_sql.
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims.
-- Everything happens in one transaction that the final RAISE rolls back.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (another publisher)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  o_role uuid; a_app uuid;
  v_n int; v_txt text; v_out text := '';
BEGIN
  -- ── fixtures (sys) ──
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_club, 'player', '[PROBE] withdrawn visible', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_role;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
  VALUES (o_role, c_player, 'withdrawn') RETURNING id INTO a_app;

  -- A1 publisher reads the withdrawn row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunity_applications WHERE id = a_app;
  v_out := v_out || E'\n' || format('%s A1 publisher reads its withdrawn applicant → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- A2 publisher still cannot change it (guard trigger)
  BEGIN
    UPDATE opportunity_applications SET status = 'shortlisted' WHERE id = a_app;
    v_out := v_out || E'\nFAIL A2 publisher changed a withdrawn application';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\n' || format('%s A2 publisher cannot change it → %s', CASE WHEN sqlerrm LIKE '%withdrawn%' THEN 'PASS' ELSE 'FAIL' END, left(sqlerrm, 60));
  END;
  EXECUTE 'RESET ROLE';

  -- B1 another publisher sees nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunity_applications WHERE id = a_app;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 another publisher → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B2 the applicant still reads their own row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM opportunity_applications WHERE id = a_app;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B2 applicant reads own withdrawn row → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B3 anon sees nothing
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_n FROM opportunity_applications WHERE id = a_app;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B3 anon → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- C1 a blocked applicant stays hidden from the publisher (undone)
  BEGIN
    UPDATE profiles SET is_blocked = true WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM opportunity_applications WHERE id = a_app;
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\n' || format('%s C1 blocked applicant hidden from publisher → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL C1 error: ' || left(sqlerrm, 80); END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  -- D1 policy shape
  SELECT pg_get_expr(polqual, polrelid) INTO v_txt FROM pg_policy
   WHERE polrelid = 'public.opportunity_applications'::regclass AND polname = 'Publishers can view applications to their opportunities';
  v_out := v_out || E'\n' || format('%s D1 publisher policy no longer filters withdrawn', CASE WHEN v_txt NOT LIKE '%withdrawn%' AND v_txt LIKE '%profile_is_hidden%' THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
