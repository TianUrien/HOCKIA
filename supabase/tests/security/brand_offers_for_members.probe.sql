-- Probe for 20261025100000_brand_offers_for_members (members see offers).
-- Staging only. One DO block ending in RAISE EXCEPTION: everything rolls back,
-- and the message carries PASS / FAIL with each check.
-- Fixtures (staging E2E accounts): brand owner + brand, a player (adult,
-- London) and a club account (no date of birth, Manchester).
-- Last run on staging 2026-10-25: PASS 22/22.
DO $$
DECLARE
  v_owner uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';
  v_brand uuid := 'ec3e0984-0a69-4c81-8424-3fcba566703e';
  v_player uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';
  v_club uuid := '38965930-2a53-47bf-85af-a0e9852c257b';
  v_pc integer; v_cc integer;
  v_a uuid; v_b uuid;
  n integer; e boolean; first_id uuid;
  out text := ''; ok boolean := true;
BEGIN
  SELECT base_country_id INTO v_pc FROM public.profiles WHERE id = v_player;
  SELECT base_country_id INTO v_cc FROM public.profiles WHERE id = v_club;
  INSERT INTO public.brand_offers (brand_id, status, title, body, link_url, country_ids, roles, live_at)
  VALUES (v_brand, 'live', 'probe A', 'body', 'https://example.com/a', ARRAY[v_pc, v_cc], ARRAY['player','club'], now())
  RETURNING id INTO v_a;

  -- as the player
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T1 eligible player sees it=%s; ', n); ok := ok AND n = 1;

  UPDATE public.brand_offers SET country_ids = ARRAY[v_cc] WHERE id = v_a AND v_cc <> v_pc;
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T2 other country=%s (want 0); ', n); ok := ok AND n = 0;
  UPDATE public.brand_offers SET country_ids = ARRAY[v_pc, v_cc] WHERE id = v_a;

  UPDATE public.brand_offers SET roles = ARRAY['club'] WHERE id = v_a;
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T3 role not targeted=%s (want 0); ', n); ok := ok AND n = 0;
  UPDATE public.brand_offers SET roles = ARRAY['player','club'] WHERE id = v_a;

  -- guard_dob_direct_write silently ignores a member writing their own birth
  -- date, so the fixture is changed with no member claims, then reset.
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET date_of_birth = (now() - interval '16 years')::date WHERE id = v_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T4 minor player=%s (want 0); ', n); ok := ok AND n = 0;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET date_of_birth = NULL WHERE id = v_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T5 player without birth date=%s (want 0); ', n); ok := ok AND n = 0;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET date_of_birth = '1995-05-15' WHERE id = v_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);

  UPDATE public.brand_offers SET area = 'Glasgow' WHERE id = v_a;
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T6 area elsewhere=%s (want 0); ', n); ok := ok AND n = 0;
  UPDATE public.brand_offers SET area = 'london' WHERE id = v_a;
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T7 area matches city=%s (want 1); ', n); ok := ok AND n = 1;
  UPDATE public.brand_offers SET area = NULL WHERE id = v_a;

  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_owner, v_player);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T8 blocked pair=%s (want 0); ', n); ok := ok AND n = 0;
  SELECT count(*) INTO n FROM public.get_brand_offer_detail(v_a);
  out := out || format('T9 detail for blocked pair rows=%s (want 0); ', n); ok := ok AND n = 0;
  DELETE FROM public.user_blocks WHERE blocker_id = v_owner AND blocked_id = v_player;

  UPDATE public.profiles SET is_blocked = true WHERE id = v_player;
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T10 hidden member=%s (want 0); ', n); ok := ok AND n = 0;
  UPDATE public.profiles SET is_blocked = false WHERE id = v_player;

  PERFORM public.dismiss_brand_offer(v_a, NULL);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T11 after Not useful=%s (want 0); ', n); ok := ok AND n = 0;
  PERFORM public.undo_dismiss_brand_offer(v_a);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T12 after Undo=%s (want 1); ', n); ok := ok AND n = 1;

  PERFORM public.dismiss_brand_offer(v_a, NULL);
  PERFORM public.dismiss_brand_offer(v_a, 'hide_brand');
  SELECT count(*) INTO n FROM public.brand_hides WHERE user_id = v_player AND brand_id = v_brand;
  out := out || format('T13 reason added later hides brand=%s (want 1); ', n); ok := ok AND n = 1;
  INSERT INTO public.brand_offers (brand_id, status, title, body, link_url, country_ids, roles, live_at)
  VALUES (v_brand, 'live', 'probe B', 'body', 'https://example.com/b', ARRAY[v_pc], ARRAY['player'], now())
  RETURNING id INTO v_b;
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.brand_id = v_brand;
  out := out || format('T14 hidden brand, other offer too=%s (want 0); ', n); ok := ok AND n = 0;
  PERFORM public.undo_dismiss_brand_offer(v_a);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.brand_id = v_brand AND o.id IN (v_a, v_b);
  out := out || format('T15 Undo restores brand=%s (want 2); ', n); ok := ok AND n = 2;

  INSERT INTO public.events (event_name, user_id, entity_type, entity_id, properties)
  VALUES ('brand_offer_impression', v_player, 'brand_offer', v_a, '{}');
  SELECT o.id INTO first_id FROM public.get_brand_offers_for_me(10) o WHERE o.id IN (v_a, v_b) LIMIT 1;
  out := out || format('T16 unseen offer first=%s; ', first_id = v_b); ok := ok AND first_id = v_b;

  SELECT d.eligible INTO e FROM public.get_brand_offer_detail(v_a) d;
  out := out || format('T17 detail eligible=%s (want true); ', e); ok := ok AND e;

  BEGIN
    PERFORM public.dismiss_brand_offer(v_a, 'spam');
    out := out || 'T18 bad reason accepted; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T18 bad reason refused; ';
  END;

  -- as the club account (organisation: no birth date needed)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_club, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_a;
  out := out || format('T19 club without birth date=%s (want 1); ', n); ok := ok AND n = 1;

  -- as the brand owner
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  UPDATE public.brand_offers SET roles = ARRAY['player','club','coach','umpire'] WHERE id = v_a;
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.brand_id = v_brand;
  out := out || format('T20 brand sees own offers=%s (want 0); ', n); ok := ok AND n = 0;

  -- grants
  out := out || format('T21 anon exec list=%s detail=%s dismiss=%s; ',
    has_function_privilege('anon', 'public.get_brand_offers_for_me(integer)', 'execute'),
    has_function_privilege('anon', 'public.get_brand_offer_detail(uuid)', 'execute'),
    has_function_privilege('anon', 'public.dismiss_brand_offer(uuid,text)', 'execute'));
  ok := ok AND NOT has_function_privilege('anon', 'public.get_brand_offers_for_me(integer)', 'execute')
          AND NOT has_function_privilege('anon', 'public.get_brand_offer_detail(uuid)', 'execute')
          AND NOT has_function_privilege('anon', 'public.dismiss_brand_offer(uuid,text)', 'execute');
  out := out || format('T22 authenticated direct read dismissals=%s hides=%s eligible_for=%s (want f/f/f)',
    has_table_privilege('authenticated', 'public.brand_offer_dismissals', 'select'),
    has_table_privilege('authenticated', 'public.brand_hides', 'select'),
    has_function_privilege('authenticated', 'public.brand_offer_eligible_for(public.brand_offers,uuid)', 'execute'));
  ok := ok AND NOT has_table_privilege('authenticated', 'public.brand_offer_dismissals', 'select')
          AND NOT has_table_privilege('authenticated', 'public.brand_hides', 'select')
          AND NOT has_function_privilege('authenticated', 'public.brand_offer_eligible_for(public.brand_offers,uuid)', 'execute');

  RAISE EXCEPTION 'PROBE % (rolled back) :: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, out;
END $$;
