-- Probe for 20261015190000: the five Overview RPCs answer an admin with the
-- new shape, and refuse a signed-in member and anon. Run via execute_sql;
-- the final RAISE rolls everything back.

DO $probe$
DECLARE
  c_member constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (not admin)
  v_j json; v_n int; v_out text := ''; v_fn text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT public.admin_get_command_center(30) INTO v_j;
  v_out := v_out || E'\n' || format('%s A1 command_center has dau_date=%s, umpire=%s, view_pairs=%s, conversion=%s',
    CASE WHEN (v_j->>'dau_date')::date = CURRENT_DATE - 1 AND v_j->'role_distribution'->>'umpire' IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    v_j->>'dau_date', v_j->'role_distribution'->>'umpire', v_j->>'view_pairs', coalesce(v_j->>'application_conversion','null'));

  SELECT count(*) INTO v_n FROM public.admin_get_signup_trends(14) WHERE umpires IS NOT NULL;
  v_out := v_out || E'\n' || format('%s A2 signup_trends returns umpires for 15 rows → %s', CASE WHEN v_n = 15 THEN 'PASS' ELSE 'FAIL' END, v_n);

  SELECT count(*) INTO v_n FROM public.admin_get_notification_ctr(30) WHERE click_count > sent_count;
  v_out := v_out || E'\n' || format('%s A3 notification_ctr never has clicks > sent → %s offending rows', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  SELECT public.admin_get_recruiting_funnel(30) INTO v_j;
  v_out := v_out || E'\n' || format('%s A4 recruiting_funnel has 7 steps → posted=%s viewed=%s applied=%s signed=%s',
    CASE WHEN json_array_length(v_j->'steps') = 7 THEN 'PASS' ELSE 'FAIL' END,
    v_j->'steps'->0->>'count', v_j->'steps'->1->>'count', v_j->'steps'->2->>'count', v_j->'steps'->6->>'count');

  SELECT count(*) INTO v_n FROM public.admin_get_signups_by_channel_week(91);
  v_out := v_out || E'\n' || format('%s A5 signups_by_channel_week rows → %s', CASE WHEN v_n > 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXECUTE 'RESET ROLE';

  -- B a plain member is refused by every function
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH v_fn IN ARRAY ARRAY['admin_get_command_center','admin_get_signup_trends','admin_get_notification_ctr','admin_get_recruiting_funnel','admin_get_signups_by_channel_week'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I(30)', v_fn) INTO v_n;
      v_out := v_out || E'\n' || format('FAIL B member was served by %s', v_fn);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || E'\n' || format('%s B member refused by %s', CASE WHEN sqlerrm LIKE '%Admin access required%' THEN 'PASS' ELSE 'FAIL' END, v_fn);
    END;
  END LOOP;
  EXECUTE 'RESET ROLE';

  -- C anon cannot execute any of them
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  FOREACH v_fn IN ARRAY ARRAY['admin_get_command_center','admin_get_signup_trends','admin_get_notification_ctr','admin_get_recruiting_funnel','admin_get_signups_by_channel_week'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I(30)', v_fn) INTO v_n;
      v_out := v_out || E'\n' || format('FAIL C anon was served by %s', v_fn);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || E'\n' || format('%s C anon refused by %s', CASE WHEN sqlerrm LIKE '%permission denied%' OR sqlerrm LIKE '%Admin access required%' THEN 'PASS' ELSE 'FAIL' END, v_fn);
    END;
  END LOOP;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
