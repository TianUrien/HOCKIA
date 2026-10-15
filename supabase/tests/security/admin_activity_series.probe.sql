-- Probe for 20261015170000: admin_get_activity_series answers an admin, and
-- refuses a signed-in member and anon. Run via execute_sql; the final RAISE
-- rolls everything back.

DO $probe$
DECLARE
  c_member constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (not admin)
  v_n int; v_out text := '';
BEGIN
  -- A admin (JWT claim app_metadata.is_admin) gets one row per day
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.admin_get_activity_series(14);
  v_out := v_out || E'\n' || format('%s A admin gets 14 rows → %s', CASE WHEN v_n = 14 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXECUTE 'RESET ROLE';

  -- B a plain member is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    SELECT count(*) INTO v_n FROM public.admin_get_activity_series(14);
    v_out := v_out || E'\nFAIL B member was served';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\n' || format('%s B member refused → %s', CASE WHEN sqlerrm LIKE '%Admin access required%' THEN 'PASS' ELSE 'FAIL' END, left(sqlerrm, 50));
  END;
  EXECUTE 'RESET ROLE';

  -- C anon cannot even execute it
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_n FROM public.admin_get_activity_series(14);
    v_out := v_out || E'\nFAIL C anon was served';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\n' || format('PASS C anon refused → %s', left(sqlerrm, 50));
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
