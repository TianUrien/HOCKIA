-- Probe for 20261110210000: admin_get_ecosystem_reach answers an admin with
-- counts only, and refuses a signed-in member and anon. Run via execute_sql
-- on staging; the final RAISE rolls everything back.

DO $probe$
DECLARE
  c_member constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (not admin)
  v_doc jsonb; v_out text := '';
BEGIN
  -- A admin gets the document with its four sections, and no person fields
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_doc := public.admin_get_ecosystem_reach(28);
  v_out := v_out || E'\n' || format('%s A admin gets countries/totals/traffic/weekly',
    CASE WHEN v_doc ? 'countries' AND v_doc ? 'totals' AND v_doc ? 'traffic' AND v_doc ? 'weekly' THEN 'PASS' ELSE 'FAIL' END);
  v_out := v_out || E'\n' || format('%s A no ids, names or emails of people in the output',
    CASE WHEN v_doc::text !~ '"(id|user_id|email|full_name|username)"' THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  -- B a plain member is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    v_doc := public.admin_get_ecosystem_reach(28);
    v_out := v_out || E'\nFAIL B member was served';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\n' || format('%s B member refused → %s', CASE WHEN sqlerrm LIKE '%Admin access required%' THEN 'PASS' ELSE 'FAIL' END, left(sqlerrm, 50));
  END;
  EXECUTE 'RESET ROLE';

  -- C anon cannot execute it
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    v_doc := public.admin_get_ecosystem_reach(28);
    v_out := v_out || E'\nFAIL C anon was served';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\n' || format('PASS C anon refused → %s', left(sqlerrm, 50));
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
