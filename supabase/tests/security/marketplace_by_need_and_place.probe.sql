-- Probe for 20261025170000_marketplace_by_need_and_place. Staging only. One DO
-- block ending in RAISE EXCEPTION: all of it rolls back; the message carries
-- PASS / FAIL and each check. Last run on staging 2026-10-25: PASS 16/16.
DO $$
DECLARE
  v_owner uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';
  v_brand uuid := 'ec3e0984-0a69-4c81-8424-3fcba566703e';
  v_player uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';
  v_club uuid := '38965930-2a53-47bf-85af-a0e9852c257b';
  v_uk integer := 46; v_de integer; v_ar integer;
  v_off uuid; v_prod uuid; n integer; nd text;
  out text := ''; ok boolean := true;
BEGIN
  SELECT id INTO v_de FROM public.countries WHERE code = 'DE';
  SELECT id INTO v_ar FROM public.countries WHERE code = 'AR';
  INSERT INTO public.brand_offers (brand_id, status, title, body, link_url, country_ids, roles, live_at, need)
  VALUES (v_brand, 'live', 'probe', 'b', 'https://example.com/a', ARRAY[v_uk, v_de], ARRAY['player'], now(), 'moving_abroad') RETURNING id INTO v_off;
  SELECT id INTO v_prod FROM public.brand_products WHERE brand_id = v_brand AND deleted_at IS NULL LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_marketplace(NULL) WHERE id IN (v_off, v_prod);
  out := out || format('T1 player sees offer + product at home=%s (want 2); ', n); ok := ok AND n = 2;
  SELECT need INTO nd FROM public.get_marketplace(NULL) WHERE id = v_off;
  out := out || format('T2 offer need=%s; ', nd); ok := ok AND nd = 'moving_abroad';
  SELECT count(*) INTO n FROM public.get_marketplace(v_de) WHERE id IN (v_off, v_prod);
  out := out || format('T3 switched to Germany=%s (want 2: offer targets it, so the brand sells there); ', n); ok := ok AND n = 2;
  SELECT count(*) INTO n FROM public.get_marketplace(v_ar) WHERE id IN (v_off, v_prod);
  out := out || format('T4 Argentina=%s (want 0); ', n); ok := ok AND n = 0;

  PERFORM public.dismiss_brand_offer(v_off, NULL);
  SELECT count(*) INTO n FROM public.get_marketplace(NULL) WHERE id = v_off;
  out := out || format('T5 dismissed offer=%s (want 0); ', n); ok := ok AND n = 0;
  PERFORM public.undo_dismiss_brand_offer(v_off);
  PERFORM public.hide_brand_offers(v_brand);
  SELECT count(*) INTO n FROM public.get_marketplace(NULL) WHERE brand_id = v_brand;
  out := out || format('T6 hidden brand=%s (want 0); ', n); ok := ok AND n = 0;
  DELETE FROM public.brand_hides WHERE user_id = v_player;

  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET date_of_birth = (now() - interval '16 years')::date WHERE id = v_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_marketplace(NULL);
  out := out || format('T7 minor sees nothing=%s; ', n = 0); ok := ok AND n = 0;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET date_of_birth = '1995-05-15' WHERE id = v_player;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_club, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_marketplace(v_uk) WHERE id = v_off;
  out := out || format('T8 club not targeted by the offer=%s (want 0); ', n); ok := ok AND n = 0;
  BEGIN
    PERFORM public.set_brand_offer_need(v_off, 'gear');
    out := out || 'T9 another member set the need; '; ok := false;
  EXCEPTION WHEN no_data_found THEN out := out || 'T9 only the brand sets its need; ';
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_marketplace(NULL);
  out := out || format('T10 brand gets no hub=%s; ', n = 0); ok := ok AND n = 0;
  PERFORM public.set_brand_offer_need(v_off, 'gear');
  IF v_prod IS NOT NULL THEN PERFORM public.set_brand_product_need(v_prod, 'for_clubs'); END IF;
  SELECT count(*) INTO n FROM public.brand_offers WHERE id = v_off AND need = 'gear';
  out := out || format('T11 brand set its need=%s; ', n); ok := ok AND n = 1;
  BEGIN
    PERFORM public.set_brand_offer_need(v_off, 'betting');
    out := out || 'T12 bad need accepted; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T12 bad need refused; ';
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  PERFORM public.suggest_brand('Fieldcover', 'https://example.com', v_de, 'player insurance');
  SELECT count(*) INTO n FROM public.brand_suggestions WHERE user_id = v_player AND brand_name = 'Fieldcover';
  out := out || format('T13 suggestion saved=%s; ', n); ok := ok AND n = 1;
  BEGIN
    PERFORM public.suggest_brand('  ');
    out := out || 'T14 empty name accepted; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T14 name required; ';
  END;
  BEGIN
    PERFORM public.admin_list_brand_suggestions(10);
    out := out || 'T15 member read suggestions; '; ok := false;
  EXCEPTION WHEN others THEN out := out || 'T15 only admins read suggestions; ';
  END;

  out := out || format('T16 anon hub=%s suggest=%s, authenticated table read=%s, anon need column=%s (want f/f/f/t)',
    has_function_privilege('anon', 'public.get_marketplace(integer)', 'execute'),
    has_function_privilege('anon', 'public.suggest_brand(text,text,integer,text)', 'execute'),
    has_table_privilege('authenticated', 'public.brand_suggestions', 'select'),
    has_column_privilege('anon', 'public.brand_offers', 'need', 'select'));
  ok := ok AND NOT has_function_privilege('anon', 'public.get_marketplace(integer)', 'execute')
          AND NOT has_function_privilege('anon', 'public.suggest_brand(text,text,integer,text)', 'execute')
          AND NOT has_table_privilege('authenticated', 'public.brand_suggestions', 'select')
          AND has_column_privilege('anon', 'public.brand_offers', 'need', 'select');

  RAISE EXCEPTION 'PROBE % (rolled back) :: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, out;
END $$;
