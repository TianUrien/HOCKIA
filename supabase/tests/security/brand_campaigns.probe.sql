-- Probe for 20261121120000_brand_campaigns.sql: campaign objectives and the
-- 7 to 15 day window in save_brand_offer, for a client that knows objectives
-- and for an installed app build that does not.
--
-- Run on STAGING only, via the SQL editor or MCP execute_sql, AFTER the
-- migration. Nothing is ever kept: the block ends by raising 'PROBE RESULTS',
-- which rolls back the whole statement.
--
-- One line per case:   PASS <case> -> <detail>   |   FAIL <case> -> <detail>
-- Every line must be PASS.
--
-- The brand is the first one with no live campaign, so the 5-live limit never
-- gets in the way. Identities are switched with request.jwt.claims; "sys"
-- steps run as the database owner.

DO $probe$
DECLARE
  v_owner uuid; v_brand uuid; v_other uuid;
  v_id uuid; v_row public.brand_offers; v_err text; v_days numeric;
  v_out text := '';
  v_now timestamptz := timezone('utc', now());
BEGIN
  SELECT b.profile_id, b.id INTO v_owner, v_brand FROM public.brands b
   WHERE b.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM public.brand_offers o WHERE o.brand_id = b.id AND o.status = 'live')
   LIMIT 1;
  SELECT b.profile_id INTO v_other FROM public.brands b WHERE b.deleted_at IS NULL AND b.id <> v_brand LIMIT 1;
  UPDATE public.brands SET open_to_partners = false WHERE id = v_brand;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- A1 a question needs no link and gets 14 days
  v_id := public.save_brand_offer(NULL, 'Ask us', 'We answer', NULL, '', '{}', '', ARRAY['player','club'], NULL, NULL, true, true, '{}', '', '', 'ask');
  SELECT * INTO v_row FROM public.brand_offers WHERE id = v_id;
  v_days := round(extract(epoch FROM v_row.ends_at - v_row.live_at) / 86400);
  v_out := v_out || CASE WHEN v_row.status = 'live' AND v_row.objective = 'ask' AND v_row.link_url IS NULL AND v_days = 14 THEN 'PASS' ELSE 'FAIL' END
    || format(' A1 ask without link -> %s %s days=%s', v_row.status, v_row.objective, v_days) || E'\n';
  PERFORM public.set_brand_offer_state(v_id, 'end');

  -- A2 an offer (no objective sent) still needs a link
  BEGIN
    PERFORM public.save_brand_offer(NULL, 'Old', 'Body', NULL, '', '{}', '', ARRAY['player'], NULL, NULL, true, true, '{}', '', '');
    v_out := v_out || E'FAIL A2 offer without link -> published\n';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_out := v_out || CASE WHEN v_err = 'invalid_offer: link_url' THEN 'PASS' ELSE 'FAIL' END || ' A2 offer without link -> ' || v_err || E'\n';
  END;

  -- B1 a client that knows the window is refused outside it
  BEGIN
    PERFORM public.save_brand_offer(NULL, 'Long', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_now + interval '30 days', true, true, '{}', '', '', 'offer');
    v_out := v_out || E'FAIL B1 30 days, new client -> published\n';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_out := v_out || CASE WHEN v_err LIKE 'campaign_window%' THEN 'PASS' ELSE 'FAIL' END || ' B1 30 days, new client -> ' || v_err || E'\n';
  END;

  -- B2 an installed build (no objective) with a 60 day end is moved to 15 days, not refused
  v_id := public.save_brand_offer(NULL, 'Old long', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_now + interval '60 days', true, true, '{}', '', '');
  SELECT * INTO v_row FROM public.brand_offers WHERE id = v_id;
  v_days := round(extract(epoch FROM v_row.ends_at - v_row.live_at) / 86400);
  v_out := v_out || CASE WHEN v_row.status = 'live' AND v_row.objective = 'offer' AND v_days = 15 THEN 'PASS' ELSE 'FAIL' END
    || format(' B2 60 days, installed build -> %s days=%s', v_row.status, v_days) || E'\n';

  -- B3 an installed build with a 2 day end is moved to 7 days
  PERFORM public.save_brand_offer(v_id, 'Old long', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_row.live_at + interval '2 days', true, true, '{}', '', '');
  SELECT * INTO v_row FROM public.brand_offers WHERE id = v_id;
  v_days := round(extract(epoch FROM v_row.ends_at - v_row.live_at) / 86400);
  v_out := v_out || CASE WHEN v_days = 7 THEN 'PASS' ELSE 'FAIL' END || format(' B3 2 days, installed build -> days=%s', v_days) || E'\n';

  -- C1 a row live for 20 days with no end date (published before the window): an edit from an installed build gives it 14 days from now
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.brand_offers SET live_at = v_now - interval '20 days', starts_at = NULL, ends_at = NULL WHERE id = v_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM public.save_brand_offer(v_id, 'Typo fixed', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, NULL, true, true, '{}', '', '');
  SELECT * INTO v_row FROM public.brand_offers WHERE id = v_id;
  v_days := round(extract(epoch FROM v_row.ends_at - v_now) / 86400);
  v_out := v_out || CASE WHEN v_row.status = 'live' AND v_row.title = 'Typo fixed' AND v_days = 14 THEN 'PASS' ELSE 'FAIL' END
    || format(' C1 old live row without end, edit -> %s, ends in %s days', v_row.status, v_days) || E'\n';

  -- C2 the same row again: its window now starts at the C1 edit (stored in starts_at), so a new client and an installed build can both edit it; the objective is kept when not sent
  PERFORM public.save_brand_offer(v_id, 'Typo fixed', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_row.ends_at, true, true, '{}', '', '', 'product');
  PERFORM public.save_brand_offer(v_id, 'Again', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_row.ends_at, true, true, '{}', '', '');
  SELECT * INTO v_row FROM public.brand_offers WHERE id = v_id;
  v_out := v_out || CASE WHEN v_row.title = 'Again' AND v_row.objective = 'product' THEN 'PASS' ELSE 'FAIL' END
    || format(' C2 edit without objective keeps it -> %s', v_row.objective) || E'\n';

  -- C3 a running campaign with an end date keeps its own window: a new client cannot push the end past it
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.brand_offers SET live_at = v_now - interval '10 days', starts_at = v_now - interval '10 days', ends_at = v_now + interval '4 days' WHERE id = v_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.save_brand_offer(v_id, 'Again', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_now + interval '14 days', true, true, '{}', '', '', 'product');
    v_out := v_out || E'FAIL C3 running campaign, end pushed to day 24 -> accepted\n';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_out := v_out || CASE WHEN v_err LIKE 'campaign_window%' THEN 'PASS' ELSE 'FAIL' END || ' C3 running campaign, end pushed to day 24 -> ' || v_err || E'\n';
  END;
  PERFORM public.save_brand_offer(v_id, 'Again', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_now + interval '5 days', true, true, '{}', '', '', 'product');
  v_out := v_out || E'PASS C3b running campaign, end moved to day 15 -> accepted\n';

  -- C4 taken down by an admin 20 days after it first went live, then published again: a new window starts now
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.brand_offers SET status = 'not_approved', live_at = v_now - interval '20 days', starts_at = v_now - interval '20 days', review_note = 'x' WHERE id = v_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM public.save_brand_offer(v_id, 'Fixed', 'Body', NULL, 'https://example.com/x', '{}', '', ARRAY['player'], NULL, v_now + interval '14 days', true, true, '{}', '', '', 'product');
  SELECT * INTO v_row FROM public.brand_offers WHERE id = v_id;
  v_out := v_out || CASE WHEN v_row.status = 'live' AND v_row.ends_at > v_now + interval '13 days' THEN 'PASS' ELSE 'FAIL' END
    || format(' C4 published again after a take-down -> %s', v_row.status) || E'\n';

  -- D1 duplicate copies the objective; the owner listing returns it
  v_id := public.duplicate_brand_offer(v_id);
  v_out := v_out || CASE WHEN (SELECT objective FROM public.brand_offers WHERE id = v_id) = 'product'
                          AND (SELECT count(*) FROM public.get_my_brand_offers() WHERE objective IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END
    || E' D1 duplicate and listing carry the objective\n';

  -- D2 an ambassador campaign needs Open to partners and is for players only
  BEGIN
    PERFORM public.save_brand_offer(NULL, 'Amb', 'Body', NULL, '', '{}', '', ARRAY['club'], NULL, NULL, true, true, '{}', '', '', 'ambassador');
    v_out := v_out || E'FAIL D2 ambassador, not open to partners -> published\n';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_out := v_out || CASE WHEN v_err = 'invalid_offer: open_to_partners' THEN 'PASS' ELSE 'FAIL' END || ' D2 ambassador, not open to partners -> ' || v_err || E'\n';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.brands SET open_to_partners = true WHERE id = v_brand;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_id := public.save_brand_offer(NULL, 'Amb', 'Body', NULL, '', '{}', '', ARRAY['club'], NULL, NULL, true, true, '{}', '', '', 'ambassador');
  v_out := v_out || CASE WHEN (SELECT roles FROM public.brand_offers WHERE id = v_id) = ARRAY['player'] THEN 'PASS' ELSE 'FAIL' END || E' D3 ambassador is for players only\n';

  -- E1 another account cannot edit this campaign (offer_not_found for a brand, not_a_brand otherwise)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.save_brand_offer(v_id, 'Mine now', 'Body', NULL, '', '{}', '', ARRAY['player'], NULL, NULL, true, true, '{}', '', '', 'ask');
    v_out := v_out || E'FAIL E1 another brand edits it -> accepted\n';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_out := v_out || CASE WHEN v_err LIKE 'offer_not_found%' OR v_err LIKE 'not_a_brand%' THEN 'PASS' ELSE 'FAIL' END || ' E1 another brand edits it -> ' || v_err || E'\n';
  END;

  -- E2 grants: anon cannot call the writers; anon reads objective but not promo_code
  v_out := v_out || CASE WHEN NOT has_function_privilege('anon', 'public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean, boolean, text[], text, text, text)', 'EXECUTE')
                          AND NOT has_function_privilege('anon', 'public.get_my_brand_offers()', 'EXECUTE')
                          AND NOT has_function_privilege('anon', 'public.duplicate_brand_offer(uuid)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END || E' E2 anon cannot call save, list or duplicate\n';
  v_out := v_out || CASE WHEN has_column_privilege('anon', 'public.brand_offers', 'objective', 'SELECT')
                          AND NOT has_column_privilege('anon', 'public.brand_offers', 'promo_code', 'SELECT')
                          AND NOT has_column_privilege('authenticated', 'public.brand_offers', 'review_note', 'SELECT') THEN 'PASS' ELSE 'FAIL' END || E' E3 objective is public, promo_code and review_note are not\n';

  RAISE EXCEPTION E'PROBE RESULTS\n%', v_out;
END
$probe$;
