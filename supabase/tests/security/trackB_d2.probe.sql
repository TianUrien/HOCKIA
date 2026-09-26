-- Probe for the D2 slice-1 migrations (20260928200000 … 20260928240000).
-- Run on STAGING only (fixture ids are the E2E accounts there) via the SQL editor or
-- MCP execute_sql, AFTER the migrations (or in the same statement as a rehearsal).
--
-- Nothing is kept: every case runs in its own sub-transaction that is always undone, and
-- the block ends by raising 'PROBE RESULTS', which rolls back the whole statement. The
-- results are in that error message, one line per case, each ending PASS or FAIL.
--
-- Optional: create TEMP TABLE d2_snapshot (id uuid, updated_at timestamptz, version int)
-- from public.profiles BEFORE applying the migrations in the same statement; the probe
-- then proves the completeness backfill did not touch updated_at / version.
--
-- Personas that do not exist as accounts (non-recruiting coach, hidden player, minor,
-- player without a date of birth) are made by flipping the E2E accounts inside the undone
-- sub-transaction.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- permit owner P (adult, test account)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';
  c_other  constant uuid := 'e4d2f85a-4b1e-4734-994a-9375cb85b4d8';  -- another adult player (non-test)
  v_out   text := '';
  v_line  text;
  v_n     int;
  v_m     int;
  v_b     boolean;
  v_b2    boolean;
  v_txt   text;
  v_j     jsonb;
  v_ts    timestamptz;
  v_id    uuid;
  v_country int;
  v_eu    int;
  v_noneu int;
  v_league int;
  v_id_pct int;
  v_persona record;
BEGIN
  SELECT id INTO v_country FROM countries WHERE code = 'GB' LIMIT 1;
  SELECT id INTO v_eu      FROM countries WHERE code = 'ES' LIMIT 1;
  SELECT id INTO v_noneu   FROM countries WHERE code = 'AR' LIMIT 1;
  SELECT id INTO v_league  FROM world_leagues ORDER BY id LIMIT 1;

  -- ── 0. Backfill did not touch updated_at / version (rehearsal only) ──
  SELECT count(*) INTO v_n FROM profiles WHERE updated_at > now() - interval '5 minutes';
  v_line := format('0a profiles with updated_at in the last 5 min = %s → %s', v_n, CASE WHEN v_n = 0 THEN 'PASS' ELSE 'CHECK (real edits?)' END);
  v_out := v_out || E'\n' || v_line;
  IF to_regclass('pg_temp.d2_snapshot') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM pg_temp.d2_snapshot s JOIN public.profiles p ON p.id = s.id
              WHERE p.updated_at IS DISTINCT FROM s.updated_at OR p.version IS DISTINCT FROM s.version' INTO v_n;
    EXECUTE 'SELECT count(*) FROM pg_temp.d2_snapshot' INTO v_m;
    v_line := format('0b backfill: rows with changed updated_at/version = %s of %s → %s', v_n, v_m, CASE WHEN v_n = 0 AND v_m > 0 THEN 'PASS' ELSE 'FAIL' END);
    v_out := v_out || E'\n' || v_line;
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal AND tgenabled = 'D';
  v_line := format('0c profiles triggers left disabled = %s → %s', v_n, CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
  v_out := v_out || E'\n' || v_line;

  -- ── 1. Permits: who can read P's permit ──
  FOR v_persona IN
    SELECT * FROM (VALUES
      ('owner P',               c_player, 'none',      1),
      ('club (recruiter)',      c_club,   'none',      1),
      ('coach, recruiting',     c_coach,  'coach_on',  1),
      ('coach, not recruiting', c_coach,  'coach_off', 0),
      ('other player',          c_other,  'none',      0),
      ('club, P hidden',        c_club,   'p_hidden',  0),
      ('anon',                  NULL,     'none',     -1)
    ) AS t(label, uid, setup, expect)
  LOOP
    BEGIN
      INSERT INTO player_work_permits (player_id, country_id, type, expires_on)
        VALUES (c_player, v_country, 'visa', current_date + 200);
      IF v_persona.setup = 'coach_off' THEN
        UPDATE profiles SET coach_recruits_for_team = false WHERE id = c_coach;
      ELSIF v_persona.setup = 'coach_on' THEN
        UPDATE profiles SET coach_recruits_for_team = true WHERE id = c_coach;
      ELSIF v_persona.setup = 'p_hidden' THEN
        UPDATE profiles SET is_blocked = true WHERE id = c_player;
      END IF;
      IF v_persona.uid IS NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        EXECUTE 'SET LOCAL ROLE anon';
      ELSE
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_persona.uid, 'role', 'authenticated')::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
      END IF;
      SELECT count(*) INTO v_n FROM player_work_permits WHERE player_id = c_player;
      v_line := format('1  permits read  %-22s sees %s → %s', v_persona.label, v_n,
        CASE WHEN v_n = v_persona.expect THEN 'PASS' ELSE 'FAIL' END);
      RAISE EXCEPTION 'probe_undo';
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'probe_undo' THEN
        v_line := format('1  permits read  %-22s error (%s) → %s', v_persona.label, SQLERRM,
          CASE WHEN v_persona.expect = -1 AND SQLSTATE = '42501' THEN 'PASS' ELSE 'FAIL' END);
      END IF;
      v_out := v_out || E'\n' || v_line;
    END;
  END LOOP;

  -- ── 2. Permits: owner CRUD, guard fields ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type, expires_on, created_at)
      VALUES (c_player, v_country, 'work_permit', current_date + 400, '2001-01-01')
      RETURNING id, created_at INTO v_id, v_ts;
    UPDATE player_work_permits SET expires_on = current_date + 20 WHERE id = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    DELETE FROM player_work_permits WHERE id = v_id;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    v_line := format('2a owner insert/update/delete → created_at forced=%s upd=%s del=%s → %s',
      v_ts > now() - interval '1 minute', v_n, v_m,
      CASE WHEN v_ts > now() - interval '1 minute' AND v_n = 1 AND v_m = 1 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '2a owner CRUD → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type, expires_on)
      VALUES (c_player, v_country, 'visa', current_date + 100) RETURNING id INTO v_id;
    UPDATE player_work_permits SET player_id = c_other WHERE id = v_id;
    v_line := '2b owner moves permit to another player → FAIL (allowed)';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '2b owner moves permit to another player → PASS (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type, expires_on)
      VALUES (c_player, v_country, 'visa', current_date + 100);
    v_line := '2c other player inserts a permit for P → FAIL (allowed)';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '2c other player inserts a permit for P → PASS (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type, expires_on)
      VALUES (c_club, v_country, 'visa', current_date + 100);
    v_line := '2d club adds a permit to itself → FAIL (allowed)';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '2d club adds a permit to itself → PASS (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    INSERT INTO player_work_permits (player_id, country_id, type, expires_on)
      VALUES (c_player, v_country, 'visa', current_date + 100) RETURNING id INTO v_id;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE player_work_permits SET expires_on = current_date + 1 WHERE id = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    DELETE FROM player_work_permits WHERE id = v_id;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    v_line := format('2e recruiter edits/deletes P''s permit → upd=%s del=%s → %s', v_n, v_m,
      CASE WHEN v_n = 0 AND v_m = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '2e recruiter edits permit → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── 2f. Expiry is optional for every type: owner saves, recruiter reads ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type) VALUES (c_player, v_country, 'visa');
    INSERT INTO player_work_permits (player_id, country_id, type) VALUES (c_player, v_country, 'work_permit');
    INSERT INTO player_work_permits (player_id, country_id, type, valid_from) VALUES (c_player, v_country, 'residency', current_date - 10);
    SELECT count(*) FILTER (WHERE work_permit_status(valid_from, expires_on) = 'valid') INTO v_n
      FROM player_work_permits WHERE player_id = c_player AND expires_on IS NULL;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_m FROM player_work_permits WHERE player_id = c_player AND expires_on IS NULL;
    v_line := format('2f no-expiry permits (visa, work permit, residency): valid=%s, recruiter sees=%s → %s', v_n, v_m,
      CASE WHEN v_n = 3 AND v_m = 3 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '2f no-expiry permits → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── 3. Permit status ──
  v_txt := concat_ws(',',
    work_permit_status(NULL, current_date + 60),
    work_permit_status(NULL, current_date + 30),
    work_permit_status(NULL, current_date),
    work_permit_status(NULL, current_date - 1),
    work_permit_status(current_date + 5, current_date + 90),
    work_permit_status(NULL, NULL),
    work_permit_status(current_date - 5, NULL),
    work_permit_status(current_date + 5, NULL));
  v_line := format('3  permit status 60d,30d,0d,-1d,future-start,no-expiry,past-start+no-expiry,future-start+no-expiry = %s → %s', v_txt,
    CASE WHEN v_txt = 'valid,expiring_soon,expiring_soon,expired,not_yet_valid,valid,valid,not_yet_valid' THEN 'PASS' ELSE 'FAIL' END);
  v_out := v_out || E'\n' || v_line;

  -- ── 4. Open to play: adult ──
  BEGIN
    UPDATE profiles SET open_to_play = false, availability_confirmed_at = NULL WHERE id = c_other;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_b := can_toggle_open_to_play(c_other);
    v_j := set_open_to_play(true, current_date + 30, 'full_season');
    EXECUTE 'RESET ROLE';
    SELECT open_to_play, availability_confirmed_at INTO v_b2, v_ts FROM profiles WHERE id = c_other;
    v_line := format('4  adult: can_toggle=%s set_open_to_play=%s stored open=%s confirmed=%s suggestible=%s → %s',
      v_b, v_j->>'outcome', v_b2, v_ts IS NOT NULL, is_suggestible(c_other),
      CASE WHEN v_b AND v_j->>'outcome' = 'saved' AND v_b2 AND v_ts IS NOT NULL AND is_suggestible(c_other) THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '4  adult open to play → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── 5. Open to play: 16-year-old (support-set DOB; the age gate freezes the account) ──
  BEGIN
    UPDATE profiles SET open_to_play = false WHERE id = c_other;
    UPDATE profiles SET date_of_birth = current_date - interval '16 years' WHERE id = c_other;
    UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_other;   -- test the age rule itself
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_b := can_toggle_open_to_play(c_other);
    v_j := set_open_to_play(true, NULL, NULL);
    v_txt := set_open_to_play(false, NULL, NULL)->>'outcome';
    v_line := format('5a minor: can_toggle=%s turn on=%s turn off=%s suggestible=%s → %s',
      v_b, v_j->>'outcome', v_txt, is_suggestible(c_other),
      CASE WHEN NOT v_b AND v_j->>'outcome' = 'under_18' AND v_txt = 'saved' AND NOT is_suggestible(c_other) THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '5a minor open to play → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    UPDATE profiles SET open_to_play = false WHERE id = c_other;
    UPDATE profiles SET date_of_birth = current_date - interval '17 years' WHERE id = c_other;
    UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_other;   -- an unfrozen minor: only the guard stops it
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE profiles SET open_to_play = true WHERE id = c_other;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('5b minor flips open_to_play directly → rows=%s → %s', v_n, CASE WHEN v_n = 0 THEN 'PASS (RLS)' ELSE 'FAIL (allowed)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '5b minor flips open_to_play directly → ' || CASE WHEN SQLSTATE = '42501' THEN 'PASS' ELSE 'FAIL' END || ' (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    UPDATE profiles SET open_to_play = false, date_of_birth = NULL WHERE id = c_other;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_j := set_open_to_play(true, NULL, NULL);
    v_line := format('5c no DOB: turn on=%s can_toggle=%s → %s', v_j->>'outcome', can_toggle_open_to_play(c_other),
      CASE WHEN v_j->>'outcome' = 'dob_required' AND NOT can_toggle_open_to_play(c_other) THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '5c no DOB → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_j := set_open_to_play(true, NULL, 'full_season');
    v_line := format('5d club calls set_open_to_play=%s → %s', v_j->>'outcome',
      CASE WHEN v_j->>'outcome' = 'not_a_player' THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '5d club set_open_to_play → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── 6. Club-facing search: 18+ only, open to play first ──
  BEGIN
    UPDATE profiles SET date_of_birth = NULL WHERE id = c_other;          -- unknown age → out
    UPDATE profiles SET open_to_play = false WHERE id = c_player;         -- mix open / not open
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_j := community_search_members(p_role => 'player', p_limit => 500)->'results';
    SELECT count(*) FILTER (WHERE (r->>'id')::uuid = c_other),
           count(*) FILTER (WHERE (r->>'id')::uuid = c_player)
      INTO v_n, v_m FROM jsonb_array_elements(v_j) r;
    -- ordering: no open_to_play_first=true after a false
    SELECT bool_and(ok) INTO v_b FROM (
      SELECT NOT ((r->>'open_to_play_first')::boolean
                  AND bool_or(NOT (r->>'open_to_play_first')::boolean) OVER (ORDER BY ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) IS TRUE) AS ok
        FROM jsonb_array_elements(v_j) WITH ORDINALITY AS x(r, ord)) s;
    EXECUTE 'RESET ROLE';
    v_line := format('6a community_search_members: no-DOB player=%s, adult not-open P=%s, open-first order=%s, rows=%s → %s',
      v_n, v_m, v_b, jsonb_array_length(v_j),
      CASE WHEN v_n = 0 AND v_m = 1 AND v_b THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '6a community_search_members → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    UPDATE profiles SET date_of_birth = NULL WHERE id = c_other;
    UPDATE profiles SET open_to_play = false WHERE id = c_player;
    v_j := discover_profiles(p_roles => ARRAY['player'], p_limit => 200)->'results';
    SELECT count(*) FILTER (WHERE (r->>'id')::uuid = c_other),
           count(*) FILTER (WHERE (r->>'id')::uuid = c_player)
      INTO v_n, v_m FROM jsonb_array_elements(v_j) r;
    SELECT bool_and(ok) INTO v_b FROM (
      SELECT NOT ((r->>'open_to_play_first')::boolean
                  AND bool_or(NOT (r->>'open_to_play_first')::boolean) OVER (ORDER BY ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) IS TRUE) AS ok
        FROM jsonb_array_elements(v_j) WITH ORDINALITY AS x(r, ord)) s;
    SELECT count(*) INTO v_n FROM jsonb_array_elements(v_j) r
      JOIN profiles p ON p.id = (r->>'id')::uuid
     WHERE NOT profile_is_adult(p.date_of_birth);
    v_line := format('6b discover_profiles (service path): non-adult players=%s, adult not-open P=%s, open-first order=%s, rows=%s → %s',
      v_n, v_m, v_b, jsonb_array_length(v_j),
      CASE WHEN v_n = 0 AND v_m = 1 AND v_b THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '6b discover_profiles → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    -- self-reported league never matches the league filter
    UPDATE profiles SET mens_league_id = v_league, womens_league_id = v_league WHERE id = c_other;
    v_j := discover_profiles(p_roles => ARRAY['player'], p_league_ids => ARRAY[v_league], p_limit => 200)->'results';
    SELECT count(*) INTO v_n FROM jsonb_array_elements(v_j) r WHERE (r->>'id')::uuid = c_other;
    SELECT source, counts_for_level, level_band IS NULL INTO v_txt, v_b, v_b2
      FROM player_league(c_other);
    v_line := format('6c self-reported league: matched by league filter=%s; player_league source=%s counts_for_level=%s band_null=%s → %s',
      v_n, coalesce(v_txt, 'none'), v_b, v_b2,
      CASE WHEN v_n = 0 AND (v_txt IS NULL OR v_txt = 'club' OR (v_txt = 'self_reported' AND NOT v_b AND v_b2)) THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '6c self-reported league → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    -- suggestion pool (club Pulse): every player row must be suggestible
    UPDATE profiles SET open_to_play = false, open_to_opportunities = true WHERE id = c_other;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*), count(*) FILTER (WHERE id = c_other) INTO v_n, v_m
      FROM get_top_community_members('player', 100, 'availability_activity', true);
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM get_top_community_members('player', 100, 'availability_activity', true) g
      JOIN profiles p ON p.id = g.id WHERE NOT is_suggestible(p.id);
    v_line := format('6d suggestion pool: non-suggestible rows=%s, open-to-opportunities-only player included=%s → %s',
      v_n, v_m, CASE WHEN v_n = 0 AND v_m = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '6d suggestion pool → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── 7. Completeness ──
  SELECT count(*) INTO v_n FROM profiles p
   WHERE p.profile_completeness_pct IS DISTINCT FROM compute_profile_completeness_pct(p);
  v_line := format('7a stored pct matches the new formula on every row: mismatches=%s → %s', v_n, CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
  v_out := v_out || E'\n' || v_line;

  BEGIN
    UPDATE profiles SET bio = NULL WHERE id = c_player;    -- make room below 100
    SELECT profile_completeness_pct INTO v_n FROM profiles WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type, expires_on)
      VALUES (c_player, v_country, 'visa', current_date + 200);
    v_j := get_my_profile_completeness();
    EXECUTE 'RESET ROLE';
    SELECT profile_completeness_pct INTO v_m FROM profiles WHERE id = c_player;
    v_line := format('7b valid permit adds the bonus: %s → %s (rpc pct=%s) → %s', v_n, v_m, v_j->>'pct',
      CASE WHEN v_m = LEAST(100, v_n + 5) AND (v_j->>'pct')::int = v_m THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '7b permit bonus → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    UPDATE profiles SET bio = NULL WHERE id = c_player;
    SELECT profile_completeness_pct INTO v_n FROM profiles WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type, valid_from)
      VALUES (c_player, v_country, 'visa', current_date + 30);           -- starts later: no bonus yet
    EXECUTE 'RESET ROLE';
    SELECT profile_completeness_pct INTO v_m FROM profiles WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_work_permits (player_id, country_id, type) VALUES (c_player, v_country, 'residency');  -- no expiry: valid
    EXECUTE 'RESET ROLE';
    SELECT profile_completeness_pct INTO v_id_pct FROM profiles WHERE id = c_player;
    v_line := format('7d no-expiry permit bonus: base %s, future-start only %s, + open-ended %s → %s', v_n, v_m, v_id_pct,
      CASE WHEN v_m = v_n AND v_id_pct = LEAST(100, v_n + 5) THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '7d no-expiry bonus → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    UPDATE profiles SET highlight_video_url = 'https://example.com/legacy' WHERE id = c_other;
    SELECT (SELECT (x->>'done')::boolean FROM jsonb_array_elements(player_completeness_parts(p)) x WHERE x->>'key' = 'video'),
           (SELECT count(*) FROM player_videos v WHERE v.user_id = p.id AND v.kind IN ('highlight','full_match') AND v.status = 'ready') + COALESCE(p.full_game_video_count, 0)
      INTO v_b, v_n FROM profiles p WHERE p.id = c_other;
    v_line := format('7c legacy highlight link alone does not count: video done=%s, uploaded videos=%s → %s', v_b, v_n,
      CASE WHEN v_b = (v_n > 0) THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '7c legacy video → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── 8. Backfill pattern re-run: stale scores fixed, updated_at / version untouched ──
  BEGIN
    ALTER TABLE public.profiles DISABLE TRIGGER USER;
    UPDATE profiles SET profile_completeness_pct = 1 WHERE role = 'player';
    ALTER TABLE public.profiles ENABLE TRIGGER USER;
    CREATE TEMP TABLE d2_probe_snap ON COMMIT DROP AS SELECT id, updated_at, version FROM profiles;
    DECLARE
      r record; v_saved jsonb := '[]'::jsonb; v_rows int;
    BEGIN
      FOR r IN SELECT t.tgname, t.tgenabled FROM pg_trigger t
                WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
                  AND (t.tgtype & 16) <> 0 AND t.tgenabled <> 'D' LOOP
        v_saved := v_saved || jsonb_build_object('name', r.tgname, 'state', r.tgenabled::text);
        EXECUTE format('ALTER TABLE public.profiles DISABLE TRIGGER %I', r.tgname);
      END LOOP;
      UPDATE public.profiles p SET profile_completeness_pct = public.compute_profile_completeness_pct(p)
       WHERE p.profile_completeness_pct IS DISTINCT FROM public.compute_profile_completeness_pct(p);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      FOR r IN SELECT x->>'name' AS name, x->>'state' AS state FROM jsonb_array_elements(v_saved) x LOOP
        EXECUTE format('ALTER TABLE public.profiles %s TRIGGER %I',
          CASE r.state WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END, r.name);
      END LOOP;
      SELECT count(*) INTO v_n FROM d2_probe_snap s JOIN profiles p ON p.id = s.id
       WHERE p.updated_at IS DISTINCT FROM s.updated_at OR p.version IS DISTINCT FROM s.version;
      SELECT count(*) INTO v_m FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal AND tgenabled = 'D';
      v_line := format('8  backfill re-run: rescored=%s, updated_at/version changed=%s, triggers left disabled=%s (paused %s) → %s',
        v_rows, v_n, v_m, jsonb_array_length(v_saved),
        CASE WHEN v_rows > 0 AND v_n = 0 AND v_m = 0 THEN 'PASS' ELSE 'FAIL' END);
    END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := '8  backfill re-run → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── 9. Application eligibility uses eu_country_ids(): identical behaviour ──
  SELECT count(*) INTO v_n FROM countries c
   WHERE (c.code = ANY (ARRAY['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
                              'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']))
         IS DISTINCT FROM (c.id = ANY (eu_country_ids()));
  SELECT count(*) INTO v_m FROM unnest(eu_country_ids());
  v_line := format('9a EU list: countries where old list ≠ eu_country_ids() = %s (eu ids = %s) → %s', v_n, v_m,
    CASE WHEN v_n = 0 AND v_m >= 27 THEN 'PASS' ELSE 'FAIL' END);
  v_out := v_out || E'\n' || v_line;

  -- The trigger function, fired on a scratch table (no notifications): temp
  -- opportunities / profiles shadow the real ones inside this sub-transaction.
  FOR v_persona IN
    SELECT * FROM (VALUES
      ('EU required, AR only',  true,  v_noneu, NULL::int, false),
      ('EU required, ES only',  true,  v_eu,    NULL,      true),
      ('EU required, AR + ES',  true,  v_noneu, v_eu,      true),
      ('EU required, none',     true,  NULL,    NULL,      true),
      ('not required, AR only', false, v_noneu, NULL,      true)
    ) AS t(label, req, n1, n2, allowed)
  LOOP
    BEGIN
      CREATE TEMP TABLE opportunities (id uuid, eu_passport_required boolean,
        opportunity_type opportunity_type, gender opportunity_gender) ON COMMIT DROP;
      CREATE TEMP TABLE profiles (id uuid, nationality_country_id int,
        nationality2_country_id int, gender text) ON COMMIT DROP;
      CREATE TEMP TABLE d2_apps (opportunity_id uuid, applicant_id uuid) ON COMMIT DROP;
      CREATE TRIGGER d2_elig BEFORE INSERT ON pg_temp.d2_apps
        FOR EACH ROW EXECUTE FUNCTION public.check_application_eligibility();
      INSERT INTO pg_temp.opportunities VALUES ('00000000-0000-0000-0000-0000000000d2', v_persona.req, 'player', 'Mixed');
      INSERT INTO pg_temp.profiles VALUES ('00000000-0000-0000-0000-0000000000a1', v_persona.n1, v_persona.n2, NULL);
      BEGIN
        INSERT INTO pg_temp.d2_apps VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1');
        v_b := true;
      EXCEPTION WHEN others THEN
        IF SQLERRM NOT LIKE '%EU passport%' THEN RAISE; END IF;
        v_b := false;
      END;
      v_line := format('9b eligibility %-22s allowed=%s → %s', v_persona.label, v_b,
        CASE WHEN v_b = v_persona.allowed THEN 'PASS' ELSE 'FAIL' END);
      RAISE EXCEPTION 'probe_undo';
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'probe_undo' THEN v_line := '9b eligibility ' || v_persona.label || ' → FAIL (' || SQLERRM || ')'; END IF;
      v_out := v_out || E'\n' || v_line;
    END;
  END LOOP;

  -- ── 10. Fingerprints of the new / replaced function bodies (compare with the files) ──
  SELECT string_agg(p.proname || '=' || md5(p.prosrc), ' ' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('work_permit_status', 'guard_player_work_permit_client_write', 'profile_is_adult',
                       'profile_is_suggestible', 'profile_has_eu_passport', 'is_suggestible',
                       'can_toggle_open_to_play', 'set_open_to_play', 'guard_open_to_play_minor',
                       'player_league', 'player_completeness_parts', 'compute_profile_completeness_pct',
                       'sync_completeness_from_player_videos', 'sync_completeness_from_work_permits',
                       'get_my_profile_completeness', 'discover_profiles', 'community_search_members',
                       'get_top_community_members', 'check_application_eligibility');
  v_out := v_out || E'\n10 md5 ' || coalesce(v_txt, '(none)');

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
