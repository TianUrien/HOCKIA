-- Probe for 20261023160000: brand offers (states, limit, access, review).
-- Run on STAGING only (E2E fixtures) via execute_sql. One transaction, rolled
-- back by the final RAISE. The admin is simulated with app_metadata.is_admin.
DO $probe$
DECLARE
  c_brand_owner constant uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';  -- E2E Test Brand's account
  c_player      constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  c_club        constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (owns a 2nd brand here)
  v_country integer;
  v_offer uuid; v_offer2 uuid; v_id uuid;
  v_txt text; v_n int; v_ok boolean; v_out text := '';
  i int;
  claims_brand text; claims_player text; claims_club text; claims_admin text;
BEGIN
  SELECT id INTO v_country FROM countries ORDER BY id LIMIT 1;
  claims_brand  := json_build_object('sub', c_brand_owner, 'role', 'authenticated')::text;
  claims_player := json_build_object('sub', c_player, 'role', 'authenticated')::text;
  claims_club   := json_build_object('sub', c_club, 'role', 'authenticated')::text;
  claims_admin  := json_build_object('sub', c_player, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text;

  -- fixture: a second brand owned by the club account (rolled back)
  INSERT INTO brands (profile_id, slug, name, category, country_id) VALUES (c_club, 'probe-brand-2', '[PROBE] Brand 2', 'equipment', v_country);

  -- A1 brand saves a draft, then sends it for review
  PERFORM set_config('request.jwt.claims', claims_brand, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_offer := save_brand_offer(NULL, 'Probe kit', '15% off your first kit', NULL, NULL, ARRAY[v_country], NULL, ARRAY['player'], NULL, NULL, false);
  SELECT status INTO v_txt FROM get_my_brand_offers() WHERE id = v_offer;
  v_out := v_out || E'\n' || format('%s A1 incomplete draft saved → %s', CASE WHEN v_txt = 'draft' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  v_ok := false;
  BEGIN PERFORM save_brand_offer(v_offer, 'Probe kit', '15% off', NULL, NULL, ARRAY[v_country], NULL, ARRAY['player'], NULL, NULL, true);
  EXCEPTION WHEN check_violation THEN v_ok := sqlerrm LIKE 'invalid_offer: link_url%'; END;
  v_out := v_out || E'\n' || format('%s A2 submit without a link is refused', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  v_ok := false;
  BEGIN PERFORM save_brand_offer(v_offer, 'Probe kit', '15% off', NULL, 'javascript:alert(1)', ARRAY[v_country], NULL, ARRAY['player'], NULL, NULL, true);
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  v_out := v_out || E'\n' || format('%s A3 a javascript: link is refused', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  PERFORM save_brand_offer(v_offer, 'Probe kit', '15% off your first kit', NULL, 'https://shop.example.com/kit', ARRAY[v_country], NULL, ARRAY['player'], NULL, NULL, true);
  SELECT status INTO v_txt FROM get_my_brand_offers() WHERE id = v_offer;
  v_out := v_out || E'\n' || format('%s A4 sent for review → %s', CASE WHEN v_txt = 'in_review' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  EXECUTE 'RESET ROLE';

  -- B members see nothing until it is approved; no direct writes
  PERFORM set_config('request.jwt.claims', claims_player, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM brand_offers WHERE id = v_offer;
  v_out := v_out || E'\n' || format('%s B1 member cannot see an offer in review → %s', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  v_ok := false;
  BEGIN UPDATE brand_offers SET status = 'live' WHERE id = v_offer; EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  v_out := v_out || E'\n' || format('%s B2 no direct UPDATE on the table', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  v_ok := false;
  BEGIN PERFORM save_brand_offer(NULL, 'x', 'y', NULL, 'https://a.b/c', ARRAY[v_country], NULL, ARRAY['player'], NULL, NULL, false);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  v_out := v_out || E'\n' || format('%s B3 a player cannot create offers (not_a_brand)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  v_ok := false;
  BEGIN PERFORM admin_review_brand_offer(v_offer, 'approve', NULL); EXCEPTION WHEN OTHERS THEN v_ok := sqlerrm LIKE 'Unauthorized%'; END;
  v_out := v_out || E'\n' || format('%s B4 a non-admin cannot approve', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  -- C another brand cannot touch it
  PERFORM set_config('request.jwt.claims', claims_club, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN PERFORM set_brand_offer_state(v_offer, 'end'); EXCEPTION WHEN no_data_found THEN v_ok := true; END;
  SELECT count(*) INTO v_n FROM get_my_brand_offers() WHERE id = v_offer;
  v_out := v_out || E'\n' || format('%s C1 another brand cannot end it or list it (%s rows)', CASE WHEN v_ok AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXECUTE 'RESET ROLE';

  -- D admin: reject needs a reason; approve makes it live and notifies the brand
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM admin_list_brand_offers('to_review') WHERE id = v_offer;
  v_out := v_out || E'\n' || format('%s D1 it is in the admin queue', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END);
  v_ok := false;
  BEGIN PERFORM admin_review_brand_offer(v_offer, 'reject', '  '); EXCEPTION WHEN check_violation THEN v_ok := sqlerrm = 'reason_required'; END;
  v_out := v_out || E'\n' || format('%s D2 reject without a reason is refused', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  v_txt := admin_review_brand_offer(v_offer, 'approve', NULL);
  v_out := v_out || E'\n' || format('%s D3 approve → %s', CASE WHEN v_txt = 'approved' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO v_n FROM profile_notifications WHERE recipient_profile_id = c_brand_owner AND source_entity_id = v_offer AND kind = 'brand_offer_approved';
  v_out := v_out || E'\n' || format('%s D4 the brand got an "approved" notification', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- E members (and visitors) now see the live offer, but never review fields
  PERFORM set_config('request.jwt.claims', claims_player, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM brand_offers WHERE id = v_offer;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s E1 member sees the live offer', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END);
  v_out := v_out || E'\n' || format('%s E2 review_note / pending / reviewed_by not readable by members or visitors',
    CASE WHEN NOT has_column_privilege('authenticated', 'public.brand_offers', 'review_note', 'SELECT')
          AND NOT has_column_privilege('anon', 'public.brand_offers', 'pending', 'SELECT')
          AND NOT has_column_privilege('authenticated', 'public.brand_offers', 'reviewed_by', 'SELECT')
          AND has_column_privilege('anon', 'public.brand_offers', 'title', 'SELECT') THEN 'PASS' ELSE 'FAIL' END);

  -- F editing a live offer: the change waits for review, the live text stays
  PERFORM set_config('request.jwt.claims', claims_brand, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM save_brand_offer(v_offer, 'Probe kit v2', '20% off your first kit', NULL, 'https://shop.example.com/kit', ARRAY[v_country], NULL, ARRAY['player','coach'], NULL, NULL, true);
  SELECT status || '/' || pending_status INTO v_txt FROM get_my_brand_offers() WHERE id = v_offer;
  EXECUTE 'RESET ROLE';
  SELECT title INTO v_txt FROM brand_offers WHERE id = v_offer;
  v_out := v_out || E'\n' || format('%s F1 edit of a live offer waits; members still see "%s"', CASE WHEN v_txt = 'Probe kit' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_txt := admin_review_brand_offer(v_offer, 'approve', NULL);
  EXECUTE 'RESET ROLE';
  SELECT title || ' ' || array_to_string(roles, ',') INTO v_txt FROM brand_offers WHERE id = v_offer;
  v_out := v_out || E'\n' || format('%s F2 approving the edit applies it → %s', CASE WHEN v_txt = 'Probe kit v2 player,coach' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- G pause hides it; the 5-live limit holds on resume and on approval
  PERFORM set_config('request.jwt.claims', claims_brand, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_brand_offer_state(v_offer, 'pause');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', claims_player, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM brand_offers WHERE id = v_offer;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s G1 a paused offer is hidden from members', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
  -- five more live offers (fixture, as system)
  FOR i IN 1..5 LOOP
    INSERT INTO brand_offers (brand_id, status, title, body, link_url, country_ids, roles, live_at)
    SELECT id, 'live', '[PROBE] live ' || i, 'x', 'https://a.example.com/x', ARRAY[v_country], ARRAY['player'], now() FROM brands WHERE profile_id = c_brand_owner;
  END LOOP;
  PERFORM set_config('request.jwt.claims', claims_brand, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN PERFORM set_brand_offer_state(v_offer, 'resume'); EXCEPTION WHEN check_violation THEN v_ok := sqlerrm LIKE 'live_limit%'; END;
  v_out := v_out || E'\n' || format('%s G2 resume refused at 5 live', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  v_offer2 := save_brand_offer(NULL, 'Sixth', 'x', NULL, 'https://a.example.com/6', ARRAY[v_country], NULL, ARRAY['player'], NULL, NULL, true);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := false;
  BEGIN PERFORM admin_review_brand_offer(v_offer2, 'approve', NULL); EXCEPTION WHEN check_violation THEN v_ok := sqlerrm LIKE 'live_limit%'; END;
  v_out := v_out || E'\n' || format('%s G3 approving a 6th live offer is refused', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  -- H reject with a reason: the brand sees it word for word
  v_txt := admin_review_brand_offer(v_offer2, 'reject', 'Remove "best price in Spain".');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', claims_brand, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT status || ' | ' || review_note INTO v_txt FROM get_my_brand_offers() WHERE id = v_offer2;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s H1 rejected with the reason → %s', CASE WHEN v_txt = 'not_approved | Remove "best price in Spain".' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- I a hidden (blocked) brand's live offers disappear for members
  UPDATE profiles SET is_blocked = true WHERE id = c_brand_owner;
  PERFORM set_config('request.jwt.claims', claims_player, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM brand_offers o JOIN brands b ON b.id = o.brand_id WHERE b.profile_id = c_brand_owner;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT v_n + count(*) INTO v_n FROM brand_offers WHERE title LIKE '[PROBE] live%';
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s I1 a hidden brand''s offers are invisible to members and visitors → %s', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
