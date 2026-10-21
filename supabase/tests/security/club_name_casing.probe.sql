-- Probe for 20261021180000_club_name_casing.sql: the casing rule (same cases
-- as client/src/__tests__/clubNameCasing.test.ts), the insert trigger, the
-- backup table fence, and that only admins can read the near-duplicate report.
--
-- Run on STAGING only, via the SQL editor or MCP execute_sql, AFTER the
-- migration. Nothing is kept: the block ends by raising 'PROBE RESULTS',
-- which rolls back the whole statement.
-- One line per case: PASS <case> → <detail> | FAIL <case> → <detail>.

DO $probe$
DECLARE
  v_cases text[][] := ARRAY[
    ['university of the western cape', 'University of the Western Cape'],
    ['club deportivo aleman', 'Club Deportivo Aleman'],
    ['jockey club de rosario', 'Jockey Club de Rosario'],
    ['te awamutu Hockey Club', 'Te Awamutu Hockey Club'],
    ['GCC Field hockey club', 'GCC Field Hockey Club'],
    ['seria A1', 'Seria A1'],
    ['La trobe', 'La Trobe'],
    ['de Terriers', 'De Terriers'],
    ['  servette  ', 'Servette'],
    ['ryde-hunters', 'Ryde-Hunters'],
    ['mcDonald park', 'mcDonald Park'],
    ['TSV  münchen   ost', 'TSV München Ost'],
    ['club atlético san isidro', 'Club Atlético San Isidro'],
    ['hc 1926', 'HC 1926'],
    ['the hague hc', 'The Hague HC'],
    ['dublin fc', 'Dublin FC'],
    ['Already Fine HC', 'Already Fine HC']
  ];
  v_i int;
  v_got text;
  v_country int;
  v_id uuid;
  v_norm text;
  v_n int;
  v_out text := '';
  v_line text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── A · the rule ─────────────────────────────────────────────────────────────
  FOR v_i IN 1..array_length(v_cases, 1) LOOP
    v_got := public.normalize_club_name_casing(v_cases[v_i][1]);
    v_out := v_out || E'\n' || format('%s A%s %L → %L (expected %L)',
      CASE WHEN v_got = v_cases[v_i][2] THEN 'PASS' ELSE 'FAIL' END, v_i, v_cases[v_i][1], v_got, v_cases[v_i][2]);
  END LOOP;
  v_got := public.normalize_club_name_casing(public.normalize_club_name_casing('club deportivo aleman'));
  v_out := v_out || E'\n' || format('%s A_idem idempotent (%L)', CASE WHEN v_got = 'Club Deportivo Aleman' THEN 'PASS' ELSE 'FAIL' END, v_got);

  -- ── B · the insert trigger ───────────────────────────────────────────────────
  SELECT id INTO v_country FROM countries ORDER BY id LIMIT 1;
  INSERT INTO world_clubs (club_id, club_name, club_name_normalized, country_id, created_from)
  VALUES ('probe_casing_' || extract(epoch from now())::bigint, '  probe  casing hockey club de zz ', 'probe  casing hockey club de zz', v_country, 'user')
  RETURNING id, club_name, club_name_normalized INTO v_id, v_got, v_norm;
  v_out := v_out || E'\n' || format('%s B1 insert stores the cased name (%L)',
    CASE WHEN v_got = 'Probe Casing Hockey Club de Zz' THEN 'PASS' ELSE 'FAIL' END, v_got);
  v_out := v_out || E'\n' || format('%s B2 club_name_normalized stays as the RPC set it (%L)',
    CASE WHEN v_norm = 'probe  casing hockey club de zz' THEN 'PASS' ELSE 'FAIL' END, v_norm);

  UPDATE world_clubs SET club_name = 'probe lowercase by admin' WHERE id = v_id RETURNING club_name INTO v_got;
  v_out := v_out || E'\n' || format('%s B3 an UPDATE keeps the admin''s casing (%L)',
    CASE WHEN v_got = 'probe lowercase by admin' THEN 'PASS' ELSE 'FAIL' END, v_got);

  SELECT count(*) INTO v_n FROM world_clubs WHERE club_name IS DISTINCT FROM public.normalize_club_name_casing(club_name) AND id <> v_id;
  v_out := v_out || E'\n' || format('%s B4 no other club name differs from the rule after the migration (rows=%s)',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── C · near-duplicate report: admin only ───────────────────────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'app_metadata', json_build_object())::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM * FROM public.admin_world_club_near_duplicates();
    v_line := 'FAIL C1 a signed-in non-admin reads the duplicate report → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS C1 a signed-in non-admin reads the duplicate report → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM * FROM public.admin_world_club_near_duplicates();
    v_line := 'FAIL C2 anon reads the duplicate report → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS C2 anon reads the duplicate report → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  -- Positive control: an admin gets rows back, including a planted pair.
  INSERT INTO world_clubs (club_id, club_name, club_name_normalized, country_id, created_from)
  VALUES ('probe_dupe_a_' || extract(epoch from now())::bigint, 'Probe Zebras HC', 'probe zebras hc', v_country, 'user'),
         ('probe_dupe_b_' || extract(epoch from now())::bigint, 'Probe-Zebras Hockey Club', 'probe-zebras hockey club', v_country, 'user');
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM public.admin_world_club_near_duplicates(0.6, 1000) d
     WHERE d.a_name LIKE 'Probe%Zebras%' AND d.b_name LIKE 'Probe%Zebras%';
    v_line := format('%s C3 an admin sees the planted pair (rows=%s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C3 an admin reads the duplicate report → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  -- ── D · the backup table is service-role only ───────────────────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM * FROM public.world_clubs_name_casing_backup LIMIT 1;
    v_line := 'FAIL D1 a signed-in user reads the casing backup → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS D1 a signed-in user reads the casing backup → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM * FROM public.world_clubs_name_casing_backup LIMIT 1;
    v_line := 'FAIL D2 anon reads the casing backup → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS D2 anon reads the casing backup → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
