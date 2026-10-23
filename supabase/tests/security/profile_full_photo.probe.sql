-- Probe for 20261023120000: profiles.avatar_full_url.
-- Run on STAGING only (fixture ids are the E2E accounts there) via execute_sql.
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims.
-- Everything happens in one transaction that the final RAISE rolls back.

DO $probe$
DECLARE
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (owner)
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (someone else)
  v_n int; v_txt text; v_out text := '';
BEGIN
  -- A1 owner writes both URLs in one update
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE profiles SET avatar_url = 'https://probe/sq.jpg', avatar_full_url = 'https://probe/full.jpg' WHERE id = c_player;
  SELECT avatar_full_url INTO v_txt FROM profiles WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s A1 owner sets both → full=%s', CASE WHEN v_txt = 'https://probe/full.jpg' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- A2 another column changes: the full photo stays
  UPDATE profiles SET bio = coalesce(bio, '') WHERE id = c_player;
  SELECT avatar_full_url INTO v_txt FROM profiles WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s A2 unrelated update keeps it → full=%s', CASE WHEN v_txt = 'https://probe/full.jpg' THEN 'PASS' ELSE 'FAIL' END, v_txt);

  -- A3 avatar_url alone changes (an old client): the stale full photo is cleared
  UPDATE profiles SET avatar_url = 'https://probe/sq2.jpg' WHERE id = c_player;
  SELECT avatar_full_url INTO v_txt FROM profiles WHERE id = c_player;
  v_out := v_out || E'\n' || format('%s A3 avatar-only update clears it → full=%s', CASE WHEN v_txt IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v_txt, 'NULL'));

  -- A4 set it back for the read checks below
  UPDATE profiles SET avatar_full_url = 'https://probe/full2.jpg' WHERE id = c_player;
  EXECUTE 'RESET ROLE';

  -- B1 someone else cannot write it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE profiles SET avatar_full_url = 'https://probe/evil.jpg' WHERE id = c_player;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- B2 but can read it, like avatar_url
  SELECT avatar_full_url INTO v_txt FROM profiles WHERE id = c_player;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B1 another member cannot write it → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  v_out := v_out || E'\n' || format('%s B2 another member reads it → %s', CASE WHEN v_txt = 'https://probe/full2.jpg' THEN 'PASS' ELSE 'FAIL' END, coalesce(v_txt, 'NULL'));

  -- C1 anon holds the same column grant as avatar_url (the E2E player is a
  -- test account, which anon's row policy hides, so check the grant itself)
  v_out := v_out || E'\n' || format('%s C1 anon SELECT grant: avatar_full_url=%s, avatar_url=%s',
    CASE WHEN has_column_privilege('anon', 'public.profiles', 'avatar_full_url', 'SELECT')
          AND has_column_privilege('anon', 'public.profiles', 'avatar_url', 'SELECT') THEN 'PASS' ELSE 'FAIL' END,
    has_column_privilege('anon', 'public.profiles', 'avatar_full_url', 'SELECT'),
    has_column_privilege('anon', 'public.profiles', 'avatar_url', 'SELECT'));
  -- C1b anon cannot write it
  v_out := v_out || E'\n' || format('%s C1b anon has no UPDATE grant', CASE WHEN NOT has_column_privilege('anon', 'public.profiles', 'avatar_full_url', 'UPDATE') THEN 'PASS' ELSE 'FAIL' END);

  -- C2 a hidden (blocked) profile's row, full photo included, is not readable
  UPDATE profiles SET is_blocked = true WHERE id = c_player;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM profiles WHERE id = c_player AND avatar_full_url IS NOT NULL;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT v_n + count(*) INTO v_n FROM profiles WHERE id = c_player AND avatar_full_url IS NOT NULL;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s C2 hidden profile: member + anon see %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
