-- Probe for 20261025130000_brand_offers_publish_now (no approval step; admin
-- take-down). Staging only. One DO block ending in RAISE EXCEPTION: all of it
-- rolls back; the message carries PASS / FAIL and each check.
-- Last run on staging 2026-10-25: PASS 13/13.
DO $$
DECLARE
  v_owner uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';
  v_player uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';
  v_admin uuid := '38965930-2a53-47bf-85af-a0e9852c257b'; -- any account; admin comes from the JWT claim
  v_pc integer; v_id uuid; v_st text; n integer; i integer;
  out text := ''; ok boolean := true;
BEGIN
  SELECT base_country_id INTO v_pc FROM public.profiles WHERE id = v_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_id := public.save_brand_offer(NULL, 'probe offer', 'what members get', NULL, 'https://example.com/p', ARRAY[v_pc], NULL, ARRAY['player'], NULL, NULL, true);
  SELECT status INTO v_st FROM public.brand_offers WHERE id = v_id;
  out := out || format('T1 publish -> %s (want live); ', v_st); ok := ok AND v_st = 'live';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_id;
  out := out || format('T2 member sees it at once=%s; ', n); ok := ok AND n = 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM public.save_brand_offer(v_id, 'probe offer edited', 'what members get', NULL, 'https://example.com/p', ARRAY[v_pc], NULL, ARRAY['player'], NULL, NULL, true);
  SELECT count(*) INTO n FROM public.brand_offers WHERE id = v_id AND title = 'probe offer edited' AND pending IS NULL AND status = 'live';
  out := out || format('T3 live edit applies at once=%s; ', n); ok := ok AND n = 1;

  BEGIN
    PERFORM public.save_brand_offer(v_id, 'x', 'y', NULL, 'https://example.com/p', ARRAY[v_pc], NULL, ARRAY['player'], NULL, NULL, false);
    out := out || 'T4 live saved as draft (should refuse); '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T4 live cannot go back to draft; ';
  END;

  BEGIN
    PERFORM public.save_brand_offer(NULL, 'bad', 'bad', NULL, 'http://example.com', ARRAY[v_pc], NULL, ARRAY['player'], NULL, NULL, true);
    out := out || 'T5 http link published; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T5 invalid offer refused; ';
  END;

  BEGIN
    FOR i IN 1..6 LOOP
      PERFORM public.save_brand_offer(NULL, 'probe ' || i, 'body', NULL, 'https://example.com/p', ARRAY[v_pc], NULL, ARRAY['player'], NULL, NULL, true);
    END LOOP;
    out := out || 'T6 sixth live offer allowed; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || format('T6 5-live limit holds (%s); ', left(SQLERRM, 10));
  END;

  BEGIN
    PERFORM public.admin_take_down_brand_offer(v_id, 'Not allowed');
    out := out || 'T7 non-admin took it down; '; ok := false;
  EXCEPTION WHEN others THEN out := out || 'T7 non-admin refused; ';
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  BEGIN
    PERFORM public.admin_take_down_brand_offer(v_id, '  ');
    out := out || 'T8 take-down without reason allowed; '; ok := false;
  EXCEPTION WHEN check_violation THEN out := out || 'T8 reason required; ';
  END;
  PERFORM public.admin_take_down_brand_offer(v_id, 'Remove the claim "best kit".');
  SELECT status INTO v_st FROM public.brand_offers WHERE id = v_id;
  out := out || format('T9 taken down -> %s; ', v_st); ok := ok AND v_st = 'not_approved';
  SELECT count(*) INTO n FROM public.profile_notifications
   WHERE recipient_profile_id = v_owner AND source_entity_id = v_id AND kind = 'brand_offer_not_approved'
     AND (metadata->>'takedown')::boolean AND metadata->>'reason' = 'Remove the claim "best kit".';
  out := out || format('T10 brand told with reason=%s; ', n); ok := ok AND n = 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.get_brand_offers_for_me(10) o WHERE o.id = v_id;
  out := out || format('T11 members no longer see it=%s (want 0); ', n); ok := ok AND n = 0;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM public.save_brand_offer(v_id, 'probe offer fixed', 'what members get', NULL, 'https://example.com/p', ARRAY[v_pc], NULL, ARRAY['player'], NULL, NULL, true);
  SELECT count(*) INTO n FROM public.brand_offers WHERE id = v_id AND status = 'live' AND review_note IS NULL;
  out := out || format('T12 brand republishes, note cleared=%s; ', n); ok := ok AND n = 1;

  out := out || format('T13 anon exec take-down=%s (want false)', has_function_privilege('anon', 'public.admin_take_down_brand_offer(uuid,text)', 'execute'));
  ok := ok AND NOT has_function_privilege('anon', 'public.admin_take_down_brand_offer(uuid,text)', 'execute');

  RAISE EXCEPTION 'PROBE % (rolled back) :: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, out;
END $$;
