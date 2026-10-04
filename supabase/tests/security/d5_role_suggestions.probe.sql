-- Probe for 20261004100000_d5_role_suggestions.sql: who may be suggested, who may
-- read the suggestions, the refresh limit and the role-change trigger.
--
-- WRITES FIXTURES (rolled back). Run on STAGING only (fixture ids are the E2E
-- accounts there), via the SQL editor or psql, AFTER the migration. Nothing is ever
-- kept: the block ends by raising 'PROBE RESULTS', which rolls back the whole
-- statement (fixture roles, applications, invites, blocks and the temporary edits
-- on the E2E player included). The MCP execute_sql tool declines write probes;
-- the grants / RLS / shape checks that need no writes are in the READ-ONLY
-- companion d5_role_suggestions_acl.probe.sql.
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT.
-- Staging note: is_staging_env() is true there, so test accounts ARE candidates
-- (prod excludes them unless the publisher is a test account); that branch is
-- not exercised here.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (recruiter, publisher)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (another recruiter)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (the candidate)
  o_role  uuid;
  o_other uuid;
  v_n     int;
  v_j     jsonb;
  v_ev    jsonb;
  v_line  text;
  v_out   text := '';

  -- Helper state for "is the player suggested right now?" (sys compute).
  v_has   boolean;
BEGIN
  -- ── fixtures (sys) ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE profiles
     SET position = 'defender', secondary_position = 'midfielder', playing_category = 'adult_women',
         open_to_play = true, date_of_birth = (current_date - interval '25 years')::date,
         onboarding_completed = true, is_blocked = false, frozen_minor_at = NULL,
         last_active_at = now(), show_last_active = true
   WHERE id = c_player;
  DELETE FROM user_blocks WHERE (blocker_id = c_player AND blocked_id = c_club) OR (blocker_id = c_club AND blocked_id = c_player);
  DELETE FROM opportunity_invites WHERE club_id = c_club AND player_id = c_player;
  DELETE FROM opportunity_applications a USING opportunities o
   WHERE o.id = a.opportunity_id AND o.club_id = c_club AND a.applicant_id = c_player;

  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] D5 women defender', 'Dublin', 'Ireland', 'draft', 'defender', 'Women')
  RETURNING id INTO o_role;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, position, gender)
  VALUES (c_club, 'player', '[PROBE] D5 other role', 'Dublin', 'Ireland', 'draft', 'forward', 'Women')
  RETURNING id INTO o_other;

  -- T1 a draft role has no suggestions; publishing it (trigger) computes them
  SELECT count(*) INTO v_n FROM role_suggestions WHERE opportunity_id = o_role;
  UPDATE opportunities SET status = 'open' WHERE id = o_role;
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  v_out := v_out || E'\n' || format('%s T1 draft has none (%s), publish trigger suggests the player → %s',
    CASE WHEN v_n = 0 AND v_has THEN 'PASS' ELSE 'FAIL' END, v_n, v_has);

  -- A1 evidence carries no private fields, rank 1..5, at most 5 rows
  SELECT evidence INTO v_ev FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player;
  SELECT count(*) INTO v_n FROM role_suggestions WHERE opportunity_id = o_role;
  v_out := v_out || E'\n' || format('%s A1 evidence has no dob/email/phone, ≤5 rows → rows=%s keys=%s',
    CASE WHEN v_ev IS NOT NULL AND NOT (v_ev ?| ARRAY['date_of_birth', 'dob', 'email', 'phone', 'contact_email', 'contact_phone', 'age'])
              AND v_n BETWEEN 1 AND 5 THEN 'PASS' ELSE 'FAIL' END,
    v_n, (SELECT string_agg(k, ',') FROM jsonb_object_keys(coalesce(v_ev, '{}'::jsonb)) k));

  -- A2 the publisher reads its rows through RLS
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM role_suggestions WHERE opportunity_id = o_role;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A2 publisher SELECTs its suggestions → %s row(s)', CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- A3 get_role_suggestions for the publisher returns the player with a fit state
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_j := get_role_suggestions(o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s A3 get_role_suggestions (publisher) → %s suggestion(s), first fit=%s',
    CASE WHEN jsonb_array_length(v_j->'suggestions') >= 1
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'suggestions') e WHERE e->>'player_id' = c_player::text AND e->>'fit_state' IN ('green', 'yellow'))
         THEN 'PASS' ELSE 'FAIL' END,
    jsonb_array_length(coalesce(v_j->'suggestions', '[]'::jsonb)), v_j->'suggestions'->0->>'fit_state');

  -- B1 the player reads nothing (RLS) and gets NULL from the RPC
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM role_suggestions;
  v_j := get_role_suggestions(o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 player sees no suggestions → rows=%s rpc=%s', CASE WHEN v_n = 0 AND v_j IS NULL THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_j::text, 'NULL'));

  -- B2 another recruiter reads nothing of this role
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM role_suggestions WHERE opportunity_id = o_role;
  v_j := get_role_suggestions(o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B2 other recruiter sees nothing → rows=%s rpc=%s', CASE WHEN v_n = 0 AND v_j IS NULL THEN 'PASS' ELSE 'FAIL' END, v_n, coalesce(v_j::text, 'NULL'));

  -- B3 anon can't read the table
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM count(*) FROM role_suggestions;
    v_line := 'FAIL B3 anon SELECT role_suggestions → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS B3 anon SELECT role_suggestions → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B4 the publisher can't write rows or call compute directly
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO role_suggestions (opportunity_id, player_id, rank, fit_score) VALUES (o_role, c_coach, 1, 1);
    v_line := 'FAIL B4a authenticated INSERT role_suggestions → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS B4a authenticated INSERT role_suggestions → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM compute_role_suggestions(o_role);
    v_line := 'FAIL B4b authenticated EXECUTE compute_role_suggestions → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS B4b authenticated EXECUTE compute_role_suggestions → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- R1 refresh: the publisher refreshes once, the second call within 10 min is limited
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_j := refresh_role_suggestions(o_role);
  v_line := v_j->>'outcome';
  v_j := refresh_role_suggestions(o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s R1 refresh then refresh → %s, %s',
    CASE WHEN v_line = 'refreshed' AND v_j->>'outcome' = 'rate_limited' THEN 'PASS' ELSE 'FAIL' END, v_line, v_j->>'outcome');

  -- R2 a non-owner's refresh is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_j := refresh_role_suggestions(o_role);
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s R2 other recruiter refresh → %s', CASE WHEN v_j->>'outcome' = 'not_owner' THEN 'PASS' ELSE 'FAIL' END, v_j->>'outcome');

  -- G1 get re-fences live: player turns Open to play off → gone without a recompute
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE profiles SET open_to_play = false WHERE id = c_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_j := get_role_suggestions(o_role);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || E'\n' || format('%s G1 get hides a player who is no longer open to play → %s',
    CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'suggestions') e WHERE e->>'player_id' = c_player::text) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_array_length(v_j->'suggestions'));
  UPDATE profiles SET open_to_play = true WHERE id = c_player;

  -- ── C · candidate fences (sys compute after each change, then undo) ────────────
  -- C1 not open to play
  UPDATE profiles SET open_to_play = false WHERE id = c_player;
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  UPDATE profiles SET open_to_play = true WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s C1 not open to play → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);

  -- C2 under 18
  UPDATE profiles SET date_of_birth = (current_date - interval '17 years')::date WHERE id = c_player;
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s C2 under 18 → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);

  -- C3 unknown date of birth
  UPDATE profiles SET date_of_birth = NULL WHERE id = c_player;
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s C3 unknown date of birth → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);

  -- C4 hidden (admin ban)
  UPDATE profiles SET is_blocked = true WHERE id = c_player;
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  UPDATE profiles SET is_blocked = false WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s C4 hidden profile → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);

  -- C5 block pair (the player blocked the club)
  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_player, c_club);
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  DELETE FROM user_blocks WHERE blocker_id = c_player AND blocked_id = c_club;
  v_out := v_out || E'\n' || format('%s C5 block pair → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);

  -- C6 wrong position (neither primary nor secondary)
  UPDATE profiles SET position = 'forward', secondary_position = NULL WHERE id = c_player;
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  UPDATE profiles SET position = 'midfielder', secondary_position = 'defender' WHERE id = c_player;
  PERFORM compute_role_suggestions(o_role);
  SELECT evidence INTO v_ev FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player;
  UPDATE profiles SET position = 'defender', secondary_position = 'midfielder' WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s C6 wrong position excluded (%s); secondary position kept as secondary → %s',
    CASE WHEN NOT v_has AND v_ev->>'position_match' = 'secondary' THEN 'PASS' ELSE 'FAIL' END, v_has, v_ev->>'position_match');

  -- C7 wrong category (a men's player on a Women's role)
  UPDATE profiles SET playing_category = 'adult_men' WHERE id = c_player;
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  UPDATE profiles SET playing_category = 'adult_women' WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s C7 wrong category → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);

  -- C8 an application to this role (any status, here withdrawn)
  BEGIN
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o_role, c_player, 'withdrawn');
    PERFORM compute_role_suggestions(o_role);
    SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
    DELETE FROM opportunity_applications WHERE opportunity_id = o_role AND applicant_id = c_player;
    v_out := v_out || E'\n' || format('%s C8 applied to this role → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);
  EXCEPTION WHEN others THEN
    v_out := v_out || E'\n' || 'FAIL C8 fixture error → ' || SQLERRM;
  END;

  -- C9 rejected by this club on another role in the last 90 days
  BEGIN
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o_other, c_player, 'rejected');
    PERFORM compute_role_suggestions(o_role);
    SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
    DELETE FROM opportunity_applications WHERE opportunity_id = o_other AND applicant_id = c_player;
    v_out := v_out || E'\n' || format('%s C9 not selected by this club < 90 days → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);
  EXCEPTION WHEN others THEN
    v_out := v_out || E'\n' || 'FAIL C9 fixture error → ' || SQLERRM;
  END;

  -- C10 an open invite from this club
  INSERT INTO opportunity_invites (opportunity_id, club_id, player_id, status, expires_at)
  VALUES (o_role, c_club, c_player, 'sent', now() + interval '14 days');
  PERFORM compute_role_suggestions(o_role);
  SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) INTO v_has;
  -- C11 the same invite passed on (declined) within 90 days
  UPDATE opportunity_invites SET status = 'declined', responded_at = now() - interval '3 days'
   WHERE club_id = c_club AND player_id = c_player AND opportunity_id = o_role;
  PERFORM compute_role_suggestions(o_role);
  v_line := (SELECT EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player))::text;
  -- ...but a pass from 120 days ago no longer excludes
  UPDATE opportunity_invites SET responded_at = now() - interval '120 days', sent_at = now() - interval '125 days'
   WHERE club_id = c_club AND player_id = c_player AND opportunity_id = o_role;
  PERFORM compute_role_suggestions(o_role);
  v_out := v_out || E'\n' || format('%s C10 open invite → suggested=%s', CASE WHEN NOT v_has THEN 'PASS' ELSE 'FAIL' END, v_has);
  v_out := v_out || E'\n' || format('%s C11 passed < 90 days → suggested=%s; passed 120 days ago → suggested=%s',
    CASE WHEN v_line = 'false' AND EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player) THEN 'PASS' ELSE 'FAIL' END,
    v_line, EXISTS (SELECT 1 FROM role_suggestions WHERE opportunity_id = o_role AND player_id = c_player));
  DELETE FROM opportunity_invites WHERE club_id = c_club AND player_id = c_player AND opportunity_id = o_role;

  -- E1 closing the role (trigger) clears its suggestions
  UPDATE opportunities SET status = 'closed' WHERE id = o_role;
  SELECT count(*) INTO v_n FROM role_suggestions WHERE opportunity_id = o_role;
  v_out := v_out || E'\n' || format('%s E1 closed role keeps no suggestions → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- E2 the nightly job runs claims-less and reports its counts
  v_j := run_role_suggestions_nightly();
  v_out := v_out || E'\n' || format('%s E2 nightly job → %s', CASE WHEN v_j ? 'roles' AND (v_j->>'failed')::int = 0 THEN 'PASS' ELSE 'FAIL' END, v_j::text);

  -- E3 the nightly job refuses a signed-in caller
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM run_role_suggestions_nightly();
    v_line := 'FAIL E3 authenticated runs the nightly job → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS E3 authenticated runs the nightly job → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
