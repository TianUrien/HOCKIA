-- Probe for 20260929300000_club_invite_adults_only.sql: who a club can invite to its squad.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), via the SQL editor or
-- MCP execute_sql, AFTER the migration (or pasted after the migration body inside one
-- transaction that is rolled back). Nothing is ever kept: the block ends by raising
-- 'PROBE RESULTS', which rolls back the whole statement.
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated + request.jwt.claims,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT.
-- Every case runs in a sub-transaction that is always rolled back (undo).

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  v_res jsonb;
  v_n int;
  v_out text := '';
  v_line text;
BEGIN
  -- fixtures (sys): no squad rows between the club and the two people
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM club_members WHERE club_profile_id = c_club AND member_profile_id IN (c_player, c_coach);

  -- A1 adult player (DOB 25 years ago) → invited
  BEGIN
    UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := invite_club_member(c_player);
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM club_members WHERE club_profile_id = c_club AND member_profile_id = c_player AND status = 'invited';
    v_line := format('%s A1 adult player → %s (rows=%s)', CASE WHEN (v_res->>'success')::boolean AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL A1 adult player → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- A2 player turning 18 today → invited (boundary)
  BEGIN
    UPDATE profiles SET date_of_birth = ((timezone('utc', now()))::date - interval '18 years')::date, frozen_minor_at = NULL WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := invite_club_member(c_player);
    EXECUTE 'RESET ROLE';
    v_line := format('%s A2 player 18 today → %s', CASE WHEN (v_res->>'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL A2 player 18 today → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B1 player aged 17 (freeze cleared so only the age rule applies) → refused, nothing written
  BEGIN
    UPDATE profiles SET date_of_birth = (current_date - interval '17 years')::date WHERE id = c_player;
    UPDATE profiles SET frozen_minor_at = NULL WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := invite_club_member(c_player);
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM club_members WHERE club_profile_id = c_club AND member_profile_id = c_player;
    v_line := format('%s B1 player aged 17 → %s (rows=%s)',
      CASE WHEN NOT (v_res->>'success')::boolean AND v_res->>'code' = 'not_invitable'
                AND v_res->>'error' = 'This person can''t be invited yet.' AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B1 player aged 17 → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B2 player with no DOB → refused (unknown age is not 18+)
  BEGIN
    UPDATE profiles SET date_of_birth = NULL, frozen_minor_at = NULL WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := invite_club_member(c_player);
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM club_members WHERE club_profile_id = c_club AND member_profile_id = c_player;
    v_line := format('%s B2 player with no DOB → %s (rows=%s)',
      CASE WHEN NOT (v_res->>'success')::boolean AND v_res->>'code' = 'not_invitable' AND v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_res, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B2 player with no DOB → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- B3 no notification queued for a refused invite
  BEGIN
    UPDATE profiles SET date_of_birth = NULL, frozen_minor_at = NULL WHERE id = c_player;
    SELECT count(*) INTO v_n FROM profile_notifications WHERE recipient_profile_id = c_player AND kind = 'club_invitation_received';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := invite_club_member(c_player);
    EXECUTE 'RESET ROLE';
    SELECT count(*) - v_n INTO v_n FROM profile_notifications WHERE recipient_profile_id = c_player AND kind = 'club_invitation_received';
    v_line := format('%s B3 refused invite queues no notification → +%s', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL B3 refused invite queues no notification → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- C1 coach with no DOB → invited (coaches are not age-gated, as in D2 search)
  BEGIN
    UPDATE profiles SET date_of_birth = NULL WHERE id = c_coach;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := invite_club_member(c_coach);
    EXECUTE 'RESET ROLE';
    v_line := format('%s C1 coach with no DOB → %s', CASE WHEN (v_res->>'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL C1 coach with no DOB → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D1 non-club caller still refused first (unchanged)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := invite_club_member(c_player);
    EXECUTE 'RESET ROLE';
    v_line := format('%s D1 coach calling it → %s', CASE WHEN v_res->>'error' = 'Only clubs can invite members' THEN 'PASS' ELSE 'FAIL' END, v_res);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D1 coach calling it → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- D2 anon still gets "Not authenticated" (unchanged)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    EXECUTE 'SET LOCAL ROLE anon';
    v_res := invite_club_member(c_player);
    EXECUTE 'RESET ROLE';
    v_line := format('%s D2 anon → %s', CASE WHEN v_res->>'error' = 'Not authenticated' THEN 'PASS' ELSE 'FAIL' END, v_res);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'FAIL D2 anon → ' || SQLERRM; END IF;
    v_out := v_out || E'\n' || v_line;
  END;
  EXECUTE 'RESET ROLE';

  -- E1 function shape: SECURITY DEFINER, search_path=public, age check present
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE oid = 'public.invite_club_member(uuid)'::regprocedure
     AND prosecdef AND proconfig @> ARRAY['search_path=public']
     AND prosrc LIKE '%profile_is_adult%';
  v_out := v_out || E'\n' || format('%s E1 definer + search_path + age check → %s', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
