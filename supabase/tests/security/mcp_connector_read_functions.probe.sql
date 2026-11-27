-- Probe for 20261125100000_mcp_connector_read_functions.sql and
-- 20261127100000_mcp_connector_minors_and_blocks.sql (cases B4, B5, Y).
-- Run on STAGING only (fixture ids are the E2E accounts there) via execute_sql.
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims.
-- Everything happens in one transaction that the final RAISE rolls back,
-- including the switch row, the fixtures and the rate-limit rows.
--
-- Covers: the switch, anonymous callers, the fixed field lists, own-data
-- scoping, recruiter-only tools, role ownership, the hidden-profile and
-- block-pair fences (list and count together), the page clamps and the limits.
-- Not covered here: the test-account fence outside staging (is_staging_env()
-- is true on staging, so test accounts are visible by design).
--
-- rate_limits has a unique index on (identifier, action_type, created_at) and
-- check_rate_limit stamps now(), which is fixed for a whole transaction. Every
-- call in a real session is its own transaction; in this single-transaction
-- probe, mcp_call clears the caller's rows stamped now() before each call, and
-- the limits are tested with rows back-dated inside the window.

CREATE OR REPLACE FUNCTION pg_temp.mcp_call(p_uid uuid, p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v jsonb;
BEGIN
  DELETE FROM public.rate_limits
   WHERE identifier = p_uid::text AND action_type LIKE 'mcp\_%' AND created_at = now();
  BEGIN
    IF p_uid IS NULL THEN
      PERFORM set_config('request.jwt.claims', '', true);
      EXECUTE 'SET LOCAL ROLE anon';
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
    END IF;
    EXECUTE 'SELECT (' || p_sql || ')::jsonb' INTO v;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    v := jsonb_build_object('error', sqlerrm);
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END;
$fn$;

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  c_banned constant text[] := ARRAY['date_of_birth', 'email', 'contact_email', 'contact_phone', 'last_active_at',
                                    'is_blocked', 'frozen_minor_at', 'is_test_account', 'dob_required_since',
                                    'profile_completeness_pct', 'score', 'components', 'level_band'];
  o_role uuid; a_app uuid;
  v jsonb; v_n int; v_i int; v_txt text; v_out text := '';
  v_keys text[];
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── S: switch off ──
  DELETE FROM app_settings WHERE key = 'mcp_connector_enabled';
  v := pg_temp.mcp_call(c_player, 'public.mcp_get_my_profile()');
  v_out := v_out || E'\n' || format('%s S1 switch off → %s', CASE WHEN v->>'error' = 'connector_disabled' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 60));
  INSERT INTO app_settings (key, value) VALUES ('mcp_connector_enabled', 'true');

  -- ── fixtures (sys) ──
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, description, gender)
  VALUES (c_club, 'player', '[PROBE-MCP] forward wanted', 'Dublin', 'Ireland', 'open', 'Probe role description', 'Mixed')
  RETURNING id INTO o_role;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
  VALUES (o_role, c_player, 'pending') RETURNING id INTO a_app;

  -- ── A: callers ──
  v := pg_temp.mcp_call(NULL, 'public.mcp_get_my_profile()');
  v_out := v_out || E'\n' || format('%s A1 anonymous caller refused → %s', CASE WHEN v ? 'error' THEN 'PASS' ELSE 'FAIL' END, left(v->>'error', 50));
  v := pg_temp.mcp_call(c_player, 'to_jsonb(public.mcp_guard(''x'', 5, 60))');
  v_out := v_out || E'\n' || format('%s A2 guard not callable by members → %s', CASE WHEN v->>'error' LIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END, left(v->>'error', 50));

  -- ── P: my profile ──
  v := pg_temp.mcp_call(c_player, 'public.mcp_get_my_profile()');
  SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(v) k;
  v_out := v_out || E'\n' || format('%s P1 own profile: id is the caller, no private field → %s',
    CASE WHEN (v->>'id')::uuid = c_player AND NOT (v_keys && c_banned) AND v ? 'completeness' THEN 'PASS' ELSE 'FAIL' END, array_to_string(v_keys, ','));

  -- ── O: opportunities ──
  v := pg_temp.mcp_call(c_player, 'public.mcp_search_opportunities(p_query => ''[PROBE-MCP]'')');
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v->'opportunities') e WHERE (e->>'id')::uuid = o_role;
  SELECT array_agg(DISTINCT k) INTO v_keys FROM jsonb_array_elements(v->'opportunities') e, jsonb_object_keys(e) k;
  v_out := v_out || E'\n' || format('%s O1 player finds the open role, no contact field → %s row(s)', CASE WHEN v_n = 1 AND NOT (v_keys && c_banned) THEN 'PASS' ELSE 'FAIL' END, v_n);
  v := pg_temp.mcp_call(c_player, format('public.mcp_get_opportunity(%L)', o_role));
  v_out := v_out || E'\n' || format('%s O2 detail carries the caller''s own application → %s', CASE WHEN v->'my_application'->>'status' = 'In review' AND NOT (v ? 'contact_email') THEN 'PASS' ELSE 'FAIL' END, left(COALESCE(v->'my_application', v)::text, 60));
  v := pg_temp.mcp_call(c_player, 'public.mcp_search_opportunities(p_page => 99)');
  v_out := v_out || E'\n' || format('%s O3 page is clamped → page %s', CASE WHEN (v->>'page')::int = 10 AND jsonb_array_length(v->'opportunities') <= 10 THEN 'PASS' ELSE 'FAIL' END, v->>'page');

  -- ── M: my applications ──
  v := pg_temp.mcp_call(c_player, 'public.mcp_list_my_applications()');
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v->'applications') e WHERE (e->>'application_id')::uuid = a_app AND e->>'status' = 'In review';
  v_out := v_out || E'\n' || format('%s M1 applicant sees own application as "In review" → %s', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  v := pg_temp.mcp_call(c_coach, 'public.mcp_list_my_applications()');
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v->'applications') e WHERE (e->>'application_id')::uuid = a_app;
  v_out := v_out || E'\n' || format('%s M2 another member does not see it → %s', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE opportunity_applications SET status = 'rejected' WHERE id = a_app;
  v := pg_temp.mcp_call(c_player, 'public.mcp_list_my_applications()');
  SELECT e->>'status' INTO v_txt FROM jsonb_array_elements(v->'applications') e WHERE (e->>'application_id')::uuid = a_app;
  v_out := v_out || E'\n' || format('%s M3 a declined application reads "Not this time" → %s', CASE WHEN v_txt = 'Not this time' THEN 'PASS' ELSE 'FAIL' END, v_txt);
  UPDATE opportunity_applications SET status = 'pending' WHERE id = a_app;

  -- ── R: recruiter-only tools ──
  v := pg_temp.mcp_call(c_player, 'public.mcp_list_my_opportunities()');
  v_out := v_out || E'\n' || format('%s R1 player: my opportunities → %s', CASE WHEN v->>'error' = 'recruiters_only' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
  v := pg_temp.mcp_call(c_player, format('public.mcp_list_applicants(%L)', o_role));
  v_out := v_out || E'\n' || format('%s R2 player: applicants → %s', CASE WHEN v->>'error' = 'recruiters_only' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
  v := pg_temp.mcp_call(c_player, 'public.mcp_search_members()');
  v_out := v_out || E'\n' || format('%s R3 player: member search → %s', CASE WHEN v->>'error' = 'recruiters_only' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
  v := pg_temp.mcp_call(c_coach, format('public.mcp_list_applicants(%L)', o_role));
  v_out := v_out || E'\n' || format('%s R4 another publisher: applicants of this role → %s', CASE WHEN v->>'error' IN ('not_found', 'recruiters_only') THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));

  -- ── C: the owning club ──
  v := pg_temp.mcp_call(c_club, 'public.mcp_list_my_opportunities()');
  SELECT (e->>'applicant_count')::int INTO v_n FROM jsonb_array_elements(v->'opportunities') e WHERE (e->>'id')::uuid = o_role;
  v_out := v_out || E'\n' || format('%s C1 club sees its role with 1 applicant → %s', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  v := pg_temp.mcp_call(c_club, format('public.mcp_list_applicants(%L)', o_role));
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v->'applicants') e WHERE (e->>'member_id')::uuid = c_player;
  SELECT array_agg(DISTINCT k) INTO v_keys FROM jsonb_array_elements(v->'applicants') e, jsonb_object_keys(e) k;
  v_out := v_out || E'\n' || format('%s C2 club lists the applicant, no private field → %s row(s) [%s]', CASE WHEN v_n = 1 AND NOT (v_keys && c_banned) THEN 'PASS' ELSE 'FAIL' END, v_n, COALESCE(array_to_string(v_keys, ','), left(v::text, 120)));

  -- ── H: hidden applicant leaves list and count together (undone) ──
  BEGIN
    UPDATE profiles SET is_blocked = true WHERE id = c_player;
    v := pg_temp.mcp_call(c_club, format('public.mcp_list_applicants(%L)', o_role));
    v_n := jsonb_array_length(v->'applicants');
    v := pg_temp.mcp_call(c_club, 'public.mcp_list_my_opportunities()');
    SELECT (e->>'applicant_count')::int INTO v_i FROM jsonb_array_elements(v->'opportunities') e WHERE (e->>'id')::uuid = o_role;
    v_out := v_out || E'\n' || format('%s H1 hidden applicant: list %s, count %s', CASE WHEN v_n = 0 AND v_i = 0 THEN 'PASS' ELSE 'FAIL' END, v_n, v_i);
    v := pg_temp.mcp_call(c_club, format('public.mcp_get_member_profile(%L)', c_player));
    v_out := v_out || E'\n' || format('%s H2 hidden member profile → %s', CASE WHEN v->>'error' = 'not_found' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
    v := pg_temp.mcp_call(c_player, 'public.mcp_get_my_profile()');
    v_out := v_out || E'\n' || format('%s H3 a hidden member cannot use the connector → %s', CASE WHEN v->>'error' = 'account_unavailable' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL H error: ' || left(sqlerrm, 80); END IF;
  END;

  -- ── H4: hidden publisher takes its role out of search and detail (undone) ──
  BEGIN
    UPDATE profiles SET is_blocked = true WHERE id = c_club;
    v := pg_temp.mcp_call(c_player, 'public.mcp_search_opportunities(p_query => ''[PROBE-MCP]'')');
    v_n := jsonb_array_length(v->'opportunities');
    v := pg_temp.mcp_call(c_player, format('public.mcp_get_opportunity(%L)', o_role));
    v_out := v_out || E'\n' || format('%s H4 hidden publisher: search %s, detail %s', CASE WHEN v_n = 0 AND v->>'error' = 'not_found' THEN 'PASS' ELSE 'FAIL' END, v_n, left(v::text, 40));
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL H4 error: ' || left(sqlerrm, 80); END IF;
  END;

  -- ── B: block pair, either side (undone) ──
  BEGIN
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_club, c_player);
    v := pg_temp.mcp_call(c_player, 'public.mcp_search_opportunities(p_query => ''[PROBE-MCP]'')');
    v_n := jsonb_array_length(v->'opportunities');
    v := pg_temp.mcp_call(c_player, format('public.mcp_get_member_profile(%L)', c_club));
    v_out := v_out || E'\n' || format('%s B1 blocked member: role search %s, blocker''s profile %s', CASE WHEN v_n = 0 AND v->>'error' = 'not_found' THEN 'PASS' ELSE 'FAIL' END, v_n, left(v::text, 40));
    v := pg_temp.mcp_call(c_club, format('public.mcp_get_member_profile(%L)', c_player));
    v_out := v_out || E'\n' || format('%s B2 blocker: blocked member''s profile → %s', CASE WHEN v->>'error' = 'not_found' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 40));
    v := pg_temp.mcp_call(c_club, 'public.mcp_search_members(p_role => ''player'', p_query => (SELECT full_name FROM profiles WHERE id = ''' || c_player || '''))');
    SELECT count(*) INTO v_n FROM jsonb_array_elements(COALESCE(v->'members', '[]'::jsonb)) e WHERE (e->>'member_id')::uuid = c_player;
    v_out := v_out || E'\n' || format('%s B3 blocker: member search does not list the blocked member → %s', CASE WHEN v_n = 0 AND NOT (v ? 'error') THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL B error: ' || left(sqlerrm, 80); END IF;
  END;

  -- ── B4/B5: block pair leaves the applicant list and count together, either side (undone) ──
  BEGIN
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_club, c_player);
    v := pg_temp.mcp_call(c_club, format('public.mcp_list_applicants(%L)', o_role));
    SELECT count(*) INTO v_n FROM jsonb_array_elements(COALESCE(v->'applicants', '[]'::jsonb)) e WHERE (e->>'member_id')::uuid = c_player;
    v := pg_temp.mcp_call(c_club, 'public.mcp_list_my_opportunities()');
    SELECT (e->>'applicant_count')::int INTO v_i FROM jsonb_array_elements(v->'opportunities') e WHERE (e->>'id')::uuid = o_role;
    v_out := v_out || E'\n' || format('%s B4 club blocked the applicant: list %s, count %s', CASE WHEN v_n = 0 AND v_i = 0 THEN 'PASS' ELSE 'FAIL' END, v_n, v_i);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL B4 error: ' || left(sqlerrm, 80); END IF;
  END;
  BEGIN
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_player, c_club);
    v := pg_temp.mcp_call(c_club, format('public.mcp_list_applicants(%L)', o_role));
    SELECT count(*) INTO v_n FROM jsonb_array_elements(COALESCE(v->'applicants', '[]'::jsonb)) e WHERE (e->>'member_id')::uuid = c_player;
    v := pg_temp.mcp_call(c_club, 'public.mcp_list_my_opportunities()');
    SELECT (e->>'applicant_count')::int INTO v_i FROM jsonb_array_elements(v->'opportunities') e WHERE (e->>'id')::uuid = o_role;
    v_out := v_out || E'\n' || format('%s B5 applicant blocked the club: list %s, count %s', CASE WHEN v_n = 0 AND v_i = 0 THEN 'PASS' ELSE 'FAIL' END, v_n, v_i);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL B5 error: ' || left(sqlerrm, 80); END IF;
  END;

  -- ── Y: under 18 or unknown age (undone); profile_is_hidden stays false here,
  --    so these check the adult fence itself, not the frozen-minor fence ──
  BEGIN
    UPDATE profiles SET date_of_birth = ((timezone('utc', now()))::date - INTERVAL '16 years')::date, frozen_minor_at = NULL WHERE id = c_player;
    v := pg_temp.mcp_call(c_player, 'public.mcp_get_my_profile()');
    v_out := v_out || E'\n' || format('%s Y1 a 16-year-old player cannot use the connector → %s', CASE WHEN v->>'error' = 'account_unavailable' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
    v := pg_temp.mcp_call(c_club, format('public.mcp_get_member_profile(%L)', c_player));
    v_out := v_out || E'\n' || format('%s Y2 a minor''s profile by known id → %s', CASE WHEN v->>'error' = 'not_found' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL Y1/Y2 error: ' || left(sqlerrm, 80); END IF;
  END;
  BEGIN
    UPDATE profiles SET date_of_birth = NULL, frozen_minor_at = NULL WHERE id = c_coach;
    v := pg_temp.mcp_call(c_coach, 'public.mcp_get_my_profile()');
    v_out := v_out || E'\n' || format('%s Y3 unknown date of birth counts as not adult → %s', CASE WHEN v->>'error' = 'account_unavailable' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
    v := pg_temp.mcp_call(c_club, 'public.mcp_get_my_profile()');
    v_out := v_out || E'\n' || format('%s Y4 a club (no date of birth) still can → %s', CASE WHEN NOT (v ? 'error') THEN 'PASS' ELSE 'FAIL' END, left(v::text, 50));
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm <> 'undo' THEN v_out := v_out || E'\nFAIL Y3/Y4 error: ' || left(sqlerrm, 80); END IF;
  END;

  -- ── D: member search and member profile ──
  v := pg_temp.mcp_call(c_club, 'public.mcp_search_members(p_page => 99)');
  SELECT array_agg(DISTINCT k) INTO v_keys FROM jsonb_array_elements(v->'members') e, jsonb_object_keys(e) k;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v->'members') e WHERE (e->>'member_id')::uuid = c_club;
  v_out := v_out || E'\n' || format('%s D1 member search: page %s, %s row(s), no private field, never the caller, no total',
    CASE WHEN (v->>'page')::int = 5 AND jsonb_array_length(v->'members') <= 10 AND NOT (COALESCE(v_keys, '{}') && c_banned) AND v_n = 0 AND NOT (v ? 'total') THEN 'PASS' ELSE 'FAIL' END,
    v->>'page', jsonb_array_length(v->'members'));
  v := pg_temp.mcp_call(c_club, 'public.mcp_search_members()');
  v_out := v_out || E'\n' || format('INFO D1b member search page 1 → %s row(s), has_more %s', jsonb_array_length(v->'members'), v->>'has_more');
  v := pg_temp.mcp_call(c_club, format('public.mcp_get_member_profile(%L)', c_player));
  SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(v) k;
  v_out := v_out || E'\n' || format('%s D2 club reads a player profile, no private field → [%s]', CASE WHEN (v->>'member_id')::uuid = c_player AND NOT (v_keys && c_banned) THEN 'PASS' ELSE 'FAIL' END, array_to_string(v_keys, ','));
  BEGIN
    UPDATE profiles SET level_target = COALESCE(level_target, 'probe') WHERE id = c_player;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v := pg_temp.mcp_call(c_player, format('public.mcp_get_member_profile(%L)', c_player));
  v_out := v_out || E'\n' || format('%s D3 a player viewer gets no level target → %s', CASE WHEN NOT (v ? 'level_target') AND NOT (v ? 'error') THEN 'PASS' ELSE 'FAIL' END, v ? 'level_target');
  v := pg_temp.mcp_call(c_club, format('public.mcp_get_member_profile(%L)', gen_random_uuid()));
  v_out := v_out || E'\n' || format('%s D4 unknown id → %s', CASE WHEN v->>'error' = 'not_found' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 40));

  -- ── L: limits (coach identity; rows back-dated inside each window) ──
  DELETE FROM rate_limits WHERE identifier = c_coach::text AND action_type LIKE 'mcp\_%';
  INSERT INTO rate_limits (identifier, action_type, created_at)
  SELECT c_coach::text, 'mcp_get_my_profile', now() - make_interval(secs => g) FROM generate_series(1, 29) g;
  v := pg_temp.mcp_call(c_coach, 'public.mcp_get_my_profile()');
  v_out := v_out || E'\n' || format('%s L1 30th profile read in an hour allowed → %s', CASE WHEN NOT (v ? 'error') THEN 'PASS' ELSE 'FAIL' END, left(v::text, 40));
  INSERT INTO rate_limits (identifier, action_type, created_at) VALUES (c_coach::text, 'mcp_get_my_profile', now() - interval '30 minutes');
  v := pg_temp.mcp_call(c_coach, 'public.mcp_get_my_profile()');
  v_out := v_out || E'\n' || format('%s L2 31st profile read in an hour refused → %s', CASE WHEN v->>'error' = 'rate_limited' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 40));
  DELETE FROM rate_limits WHERE identifier = c_coach::text AND action_type LIKE 'mcp\_%';
  INSERT INTO rate_limits (identifier, action_type, created_at)
  SELECT c_coach::text, 'mcp_all', now() - make_interval(secs => g) FROM generate_series(1, 60) g;
  v := pg_temp.mcp_call(c_coach, 'public.mcp_search_opportunities()');
  v_out := v_out || E'\n' || format('%s L3 hourly ceiling across tools (60) → %s', CASE WHEN v->>'error' = 'rate_limited' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 40));
  DELETE FROM rate_limits WHERE identifier = c_club::text AND action_type LIKE 'mcp\_%';
  INSERT INTO rate_limits (identifier, action_type, created_at)
  SELECT c_club::text, 'mcp_search_members_day', now() - make_interval(hours => 2, secs => g) FROM generate_series(1, 60) g;
  v := pg_temp.mcp_call(c_club, 'public.mcp_search_members()');
  v_out := v_out || E'\n' || format('%s L4 member search daily cap (60) → %s', CASE WHEN v->>'error' = 'rate_limited' THEN 'PASS' ELSE 'FAIL' END, left(v::text, 40));
  -- Dates more than the window ago do not count.
  DELETE FROM rate_limits WHERE identifier = c_coach::text AND action_type LIKE 'mcp\_%';
  INSERT INTO rate_limits (identifier, action_type, created_at)
  SELECT c_coach::text, 'mcp_get_my_profile', now() - interval '2 hours' - make_interval(secs => g) FROM generate_series(1, 40) g;
  v := pg_temp.mcp_call(c_coach, 'public.mcp_get_my_profile()');
  v_out := v_out || E'\n' || format('%s L5 reads older than the hour do not count → %s', CASE WHEN NOT (v ? 'error') THEN 'PASS' ELSE 'FAIL' END, left(v::text, 40));

  RAISE EXCEPTION E'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
