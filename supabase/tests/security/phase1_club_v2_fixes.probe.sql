-- Probe for migration 20260926130000_club_v2_fixes (Phase 1 · step 6, Club v2 bugs).
-- Run on STAGING (fixture = the E2E club account) via the SQL editor or MCP execute_sql.
-- Nothing is kept: each case runs in a sub-transaction that is always undone, and the block
-- ends by raising 'PROBE RESULTS' (the whole statement rolls back). Results are in that message:
--   GUARD … → REJECTED   a youth player role was refused (expected after)
--   GUARD … → ACCEPTED   the hole is open (expected before, a failure after)
--   LEGIT … → OK / BROKEN
--   SEARCH …             search_world_clubs checks

DO $probe$
DECLARE
  c_club constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- clubplayr8
  v_role uuid;
  v_n int;
  v_m int;
  v_country int;
  v_line text;
  v_out text := '';
  g text;
BEGIN
  SELECT id INTO v_role FROM opportunities WHERE club_id = c_club AND opportunity_type = 'player' LIMIT 1;

  -- ── G1/G2 club inserts a player role for Boys / Girls ──
  FOREACH g IN ARRAY ARRAY['Boys', 'Girls'] LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      INSERT INTO opportunities (club_id, opportunity_type, position, gender, title, location_city, location_country, status)
      VALUES (c_club, 'player', 'midfielder', g::opportunity_gender, '[QA] probe youth', 'Probe', 'Probe', 'draft');
      v_line := format('GUARD insert player role gender=%s → ACCEPTED', g);
      RAISE EXCEPTION 'probe_undo';
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'probe_undo' THEN v_line := format('GUARD insert player role gender=%s → REJECTED (%s)', g, SQLERRM); END IF;
      v_out := v_out || E'\n' || v_line;
    END;
  END LOOP;

  -- ── G3 club turns an existing player role into a Boys role ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunities SET gender = 'Boys' WHERE id = v_role;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('GUARD update player role → Boys → %s', CASE WHEN v_n > 0 THEN 'ACCEPTED' ELSE 'no row (fixture missing)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'GUARD update player role → Boys → REJECTED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── G4 service role is bound too (constraint, not a client-only guard) ──
  BEGIN
    INSERT INTO opportunities (club_id, opportunity_type, position, gender, title, location_city, location_country, status)
    VALUES (c_club, 'player', 'midfielder', 'Girls', '[QA] probe youth', 'Probe', 'Probe', 'draft');
    v_line := 'GUARD owner/service insert player role gender=Girls → ACCEPTED';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'GUARD owner/service insert player role gender=Girls → REJECTED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── L1 adult player role / L2 coach role for a youth team still work ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunities (club_id, opportunity_type, position, gender, title, location_city, location_country, status)
    VALUES (c_club, 'player', 'midfielder', 'Women', '[QA] probe adult', 'Probe', 'Probe', 'draft');
    v_line := 'LEGIT insert player role gender=Women → OK';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT insert player role gender=Women → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunities (club_id, opportunity_type, position, gender, title, location_city, location_country, status)
    VALUES (c_club, 'coach', 'youth_coach', 'Boys', '[QA] probe youth coach', 'Probe', 'Probe', 'draft');
    v_line := 'LEGIT insert coach role gender=Boys → OK';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT insert coach role gender=Boys → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── S1 old 2-arg / 1-arg calls (current web + August native) still resolve, as anon ──
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT count(*) INTO v_n FROM search_world_clubs(p_query => 'hockey', p_limit => 40);
    SELECT count(*) INTO v_m FROM search_world_clubs(p_query => 'club');
    v_line := format('SEARCH anon named {p_query,p_limit}=40 → %s rows; {p_query} → %s rows (default 15)', v_n, v_m);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'SEARCH anon old-signature call → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── S2 country filter: only that country, and finds clubs the global top-40 missed ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    -- the country with the most 'hockey' clubs outside the global top 40
    SELECT wc.country_id INTO v_country
    FROM search_world_clubs('hockey', 100000) wc
    WHERE wc.id NOT IN (SELECT id FROM search_world_clubs('hockey', 40))
    GROUP BY wc.country_id ORDER BY count(*) DESC LIMIT 1;
    SELECT count(*) FILTER (WHERE country_id <> v_country), count(*) INTO v_n, v_m
    FROM search_world_clubs('hockey', 8, v_country);
    -- how many of that country's matches the old global top-40 hid (staging 2026-09-26: 2 of 17 for country 185)
    SELECT count(*) INTO g FROM search_world_clubs('hockey', 40, v_country) s
    WHERE s.id NOT IN (SELECT id FROM search_world_clubs('hockey', 40));
    v_line := format('SEARCH authenticated p_country_id=%s → %s rows, %s from other countries (must be 0), %s of its matches the old global-40 filter hid',
                     v_country, v_m, v_n, g);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'SEARCH country filter → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
