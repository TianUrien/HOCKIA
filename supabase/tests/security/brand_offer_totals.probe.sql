-- Probe for 20261023200000_brand_offer_totals (get_my_brand_offer_totals and
-- the automated-browser filter on get_my_brand_offers). Staging only.
-- Everything runs in one DO block that ends in RAISE EXCEPTION, so all of it
-- rolls back; the exception message carries PASS / FAIL and each check.
-- Last run on staging 2026-10-23: PASS 7/7.
-- Fixtures (staging): brand owner, a player and a club, all E2E accounts
-- (temporarily marked non-test inside the block).
DO $$
DECLARE
  v_owner uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';
  v_player uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';
  v_club uuid := '38965930-2a53-47bf-85af-a0e9852c257b';
  v_brand uuid := 'ec3e0984-0a69-4c81-8424-3fcba566703e';
  v_offer uuid;
  r record;
  out text := '';
  ok boolean := true;
BEGIN
  UPDATE public.profiles SET is_test_account = false WHERE id IN (v_player, v_club);
  INSERT INTO public.brand_offers (brand_id, status, title) VALUES (v_brand, 'draft', 'probe') RETURNING id INTO v_offer;
  INSERT INTO public.events (event_name, user_id, entity_type, entity_id, properties) VALUES
    ('brand_offer_impression', v_player, 'brand_offer', v_offer, '{}'),
    ('brand_offer_impression', v_player, 'brand_offer', v_offer, '{}'),
    ('brand_offer_open', v_player, 'brand_offer', v_offer, '{}'),
    ('brand_offer_impression', v_club, 'brand_offer', v_offer, '{"is_automated": true}'),
    ('brand_offer_contact', v_club, 'brand_offer', v_offer, '{"is_automated": true}'),
    ('brand_offer_impression', v_owner, 'brand_offer', v_offer, '{}'),
    ('brand_offer_impression', v_player, 'brand_offer', v_offer, '{}');
  INSERT INTO public.events (event_name, user_id, entity_type, entity_id, properties, created_at) VALUES
    ('brand_offer_contact', v_player, 'brand_offer', v_offer, '{}', now() - interval '40 days');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT * INTO r FROM public.get_my_brand_offer_totals(30);
  out := out || format('T1 30d shown=%s opened=%s contacted=%s (want 1/1/0); ', r.shown, r.opened, r.contacted);
  ok := ok AND r.shown = 1 AND r.opened = 1 AND r.contacted = 0;

  SELECT * INTO r FROM public.get_my_brand_offer_totals(60);
  out := out || format('T2 60d contacted=%s (want 1); ', r.contacted);
  ok := ok AND r.contacted = 1;

  INSERT INTO public.events (event_name, user_id, entity_type, entity_id, properties) VALUES ('brand_offer_impression', v_club, 'brand_offer', v_offer, '{}');
  SELECT * INTO r FROM public.get_my_brand_offer_totals(30);
  out := out || format('T3 shown=%s (want 2); ', r.shown);
  ok := ok AND r.shown = 2;

  UPDATE public.profiles SET is_test_account = true WHERE id = v_club;
  SELECT * INTO r FROM public.get_my_brand_offer_totals(30);
  out := out || format('T4 test account excluded shown=%s (want 1); ', r.shown);
  ok := ok AND r.shown = 1;

  SELECT shown INTO r FROM public.get_my_brand_offers() WHERE id = v_offer;
  out := out || format('T5 list shown=%s (want 1); ', r.shown);
  ok := ok AND r.shown = 1;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
    PERFORM public.get_my_brand_offer_totals(30);
    out := out || 'T6 non-brand caller NOT refused; ';
    ok := false;
  EXCEPTION WHEN others THEN
    out := out || format('T6 non-brand caller refused (%s); ', SQLERRM);
  END;

  out := out || format('T7 anon execute=%s (want false)', has_function_privilege('anon', 'public.get_my_brand_offer_totals(integer)', 'execute'));
  ok := ok AND NOT has_function_privilege('anon', 'public.get_my_brand_offer_totals(integer)', 'execute');

  RAISE EXCEPTION 'PROBE % (rolled back) :: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, out;
END $$;
