-- Probe for 20261025150000_member_goals_and_gear_rail. Staging only. One DO
-- block ending in RAISE EXCEPTION: all of it rolls back; the message carries
-- PASS / FAIL and each check. Last run on staging 2026-10-25: PASS 14/14.
DO $$
DECLARE
  v_player uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';
  v_club uuid := '38965930-2a53-47bf-85af-a0e9852c257b';
  v_owner uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';
  v_off uuid; g record; a jsonb; a2 jsonb; n integer; n2 integer;
  out text := ''; ok boolean := true;
BEGIN
  INSERT INTO public.brand_offers (brand_id, status, title, body, link_url, country_ids, roles, live_at)
  VALUES ('ec3e0984-0a69-4c81-8424-3fcba566703e', 'live', 'probe', 'b', 'https://example.com/a', ARRAY[46], ARRAY['player'], now()) RETURNING id INTO v_off;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT * INTO g FROM public.get_my_goal();
  out := out || format('T1 new member is asked=%s; ', g.should_ask); ok := ok AND g.should_ask;
  BEGIN PERFORM public.set_my_goal(ARRAY['fill_role'], NULL); out := out || 'T2 club key accepted for a player; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T2 wrong-role key refused; '; END;
  BEGIN PERFORM public.set_my_goal(ARRAY['play_abroad', 'move_up', 'get_sponsor'], 'and more'); out := out || 'T3 four picks accepted; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T3 more than three refused; '; END;
  BEGIN PERFORM public.set_my_goal(ARRAY[]::text[], repeat('x', 121)); out := out || 'T4 121 chars accepted; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T4 long text refused; '; END;
  PERFORM public.set_my_goal(ARRAY['play_abroad', 'get_sponsor'], 'Play in Germany');
  SELECT * INTO g FROM public.get_my_goal();
  out := out || format('T5 goal saved=%s/%s, no longer asked=%s; ', g.options, g.other_text, NOT g.should_ask);
  ok := ok AND g.options @> ARRAY['play_abroad', 'get_sponsor'] AND cardinality(g.options) = 2 AND g.other_text = 'Play in Germany';
  ok := ok AND NOT g.should_ask;

  -- another member never sees it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_club, 'role', 'authenticated')::text, true);
  SELECT * INTO g FROM public.get_my_goal();
  out := out || format('T6 other member sees own (empty) goal only=%s; ', cardinality(g.options) = 0); ok := ok AND cardinality(g.options) = 0;
  -- Later twice stops the ask
  PERFORM public.goal_later();
  SELECT * INTO g FROM public.get_my_goal();
  out := out || format('T7 after Later not asked=%s; ', NOT g.should_ask); ok := ok AND NOT g.should_ask;
  UPDATE public.member_goals SET later_until = now() - interval '1 day' WHERE profile_id = v_club;
  SELECT * INTO g FROM public.get_my_goal();
  out := out || format('T8 asked again after 7 days=%s; ', g.should_ask); ok := ok AND g.should_ask;
  PERFORM public.goal_later();
  UPDATE public.member_goals SET later_until = now() - interval '1 day' WHERE profile_id = v_club;
  SELECT * INTO g FROM public.get_my_goal();
  out := out || format('T9 never after the second Later=%s; ', NOT g.should_ask); ok := ok AND NOT g.should_ask;

  -- club rows ignore hidden applicants
  a := public.get_my_goal_actions();
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET is_blocked = true WHERE id IN (
    SELECT a2.applicant_id FROM public.opportunity_applications a2 JOIN public.opportunities o ON o.id = a2.opportunity_id
     WHERE o.club_id = v_club AND o.status = 'open' AND a2.status = 'pending');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_club, 'role', 'authenticated')::text, true);
  a2 := public.get_my_goal_actions();
  out := out || format('T10 applicants waiting %s -> %s once hidden (want 0); ', a->>'applicants_waiting', a2->>'applicants_waiting');
  ok := ok AND (a2->>'applicants_waiting')::int = 0;

  -- player rows ignore hidden clubs (the player may have been hidden as an applicant above)
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET is_blocked = false WHERE id = v_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  a := public.get_my_goal_actions();
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET is_blocked = true WHERE role = 'club';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  a2 := public.get_my_goal_actions();
  out := out || format('T11 roles %s/%s -> %s/%s with every club hidden (want 0/0); ', a->>'roles_home', a->>'roles_abroad', a2->>'roles_home', a2->>'roles_abroad');
  ok := ok AND (a2->>'roles_home')::int = 0 AND (a2->>'roles_abroad')::int = 0;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET is_blocked = false WHERE role = 'club';

  -- gear rail: adult player sees tiles, a minor and the brand itself see none
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_home_gear_rail(6);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET date_of_birth = (now() - interval '16 years')::date WHERE id = v_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n2 FROM public.get_home_gear_rail(6);
  out := out || format('T12 rail tiles adult=%s minor=%s (want >0 / 0); ', n, n2); ok := ok AND n > 0 AND n2 = 0;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_home_gear_rail(6);
  out := out || format('T13 brand gets no rail=%s; ', n = 0); ok := ok AND n = 0;

  out := out || format('T14 anon exec goal/rail=%s/%s, authenticated table read=%s (want f/f/f)',
    has_function_privilege('anon', 'public.get_my_goal()', 'execute'),
    has_function_privilege('anon', 'public.get_home_gear_rail(integer)', 'execute'),
    has_table_privilege('authenticated', 'public.member_goals', 'select'));
  ok := ok AND NOT has_function_privilege('anon', 'public.get_my_goal()', 'execute')
          AND NOT has_function_privilege('anon', 'public.get_home_gear_rail(integer)', 'execute')
          AND NOT has_table_privilege('authenticated', 'public.member_goals', 'select');

  RAISE EXCEPTION 'PROBE % (rolled back) :: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, out;
END $$;
