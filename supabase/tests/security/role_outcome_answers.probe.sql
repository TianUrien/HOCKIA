-- Probe for 20261121100000: a role's publisher records and reads its own
-- outcome answer; another publisher, the applicant and anon cannot read or
-- write it; the picked applicant must belong to that role.
-- Run on STAGING only (fixture ids are the E2E accounts there) via execute_sql.
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims.
-- Everything happens in one transaction that the final RAISE rolls back.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (another publisher)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  o_role uuid; o_other uuid; a_app uuid; a_other uuid;
  v_n int; v_out text := '';
BEGIN
  -- fixtures (sys)
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, closed_reason)
  VALUES (c_club, 'player', '[PROBE] outcome', 'Dublin', 'Ireland', 'closed', 'expired') RETURNING id INTO o_role;
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
  VALUES (c_coach, 'player', '[PROBE] outcome other', 'Dublin', 'Ireland', 'open') RETURNING id INTO o_other;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o_role, c_player, 'shortlisted') RETURNING id INTO a_app;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status) VALUES (o_other, c_player, 'pending') RETURNING id INTO a_other;

  -- A1 publisher records its own answer, with an applicant of that role
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO role_outcome_answers (opportunity_id, recruiter_id, outcome, hired_application_id, asked_via) VALUES (o_role, c_club, 'filled_hockia', a_app, 'expiry');
    v_out := v_out || E'\nPASS A1 publisher records its own answer';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\nFAIL A1 publisher could not record: ' || left(sqlerrm, 70);
  END;
  -- A2 publisher reads it
  SELECT count(*) INTO v_n FROM role_outcome_answers WHERE opportunity_id = o_role;
  v_out := v_out || E'\n' || format('%s A2 publisher reads its answer → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  -- A3 publisher changes its answer
  UPDATE role_outcome_answers SET outcome = 'still_looking', hired_application_id = NULL WHERE opportunity_id = o_role;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || E'\n' || format('%s A3 publisher changes its answer → %s row(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  -- A4 an applicant of ANOTHER role cannot be picked
  BEGIN
    UPDATE role_outcome_answers SET outcome = 'filled_hockia', hired_application_id = a_other WHERE opportunity_id = o_role;
    v_out := v_out || E'\nFAIL A4 picked an applicant of another role';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\nPASS A4 applicant of another role refused';
  END;
  -- A5 publisher cannot answer for a role it does not own
  BEGIN
    INSERT INTO role_outcome_answers (opportunity_id, recruiter_id, outcome, asked_via) VALUES (o_other, c_club, 'still_looking', 'close');
    v_out := v_out || E'\nFAIL A5 answered for a role it does not own';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\nPASS A5 role of another publisher refused';
  END;
  -- A6 publisher cannot delete (no grant)
  BEGIN
    DELETE FROM role_outcome_answers WHERE opportunity_id = o_role;
    v_out := v_out || E'\nFAIL A6 publisher deleted an answer';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\nPASS A6 delete refused';
  END;
  EXECUTE 'RESET ROLE';

  -- B1 another publisher sees nothing and cannot write under the owner's name
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM role_outcome_answers WHERE opportunity_id = o_role;
  v_out := v_out || E'\n' || format('%s B1 another publisher → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  UPDATE role_outcome_answers SET outcome = 'skipped' WHERE opportunity_id = o_role;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_out := v_out || E'\n' || format('%s B2 another publisher changes → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXECUTE 'RESET ROLE';

  -- B3 the applicant sees nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM role_outcome_answers WHERE opportunity_id = o_role;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || format('%s B3 applicant → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B4 anon has no access at all
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_n FROM role_outcome_answers;
    v_out := v_out || E'\n' || format('%s B4 anon → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\nPASS B4 anon refused';
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULTS (rolled back):%', v_out;
END
$probe$;
