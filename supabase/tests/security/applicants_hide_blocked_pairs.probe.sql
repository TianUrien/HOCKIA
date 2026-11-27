-- Probe for 20261127120000_applicants_hide_blocked_pairs.sql: a club does not
-- see, or count, an applicant in a block pair with it (either side); with no
-- block the applicant is listed and counted as before.
-- Run on STAGING only (E2E fixture ids), AFTER the migration. Everything rolls
-- back: the block ends by raising 'PROBE RESULT'.

CREATE OR REPLACE FUNCTION pg_temp.club_view(p_club uuid, p_role uuid, p_app uuid)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_rows int; v_count int; v_health jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_club, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_club::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_rows FROM public.opportunity_applications WHERE id = p_app;
  v_health := public.get_my_roles_health();
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT (e->>'applicant_count')::int INTO v_count FROM jsonb_array_elements(v_health) e WHERE (e->>'opportunity_id')::uuid = p_role;
  RETURN v_rows || '/' || COALESCE(v_count, -1);
END $f$;

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  o_role uuid;
  a_app uuid;
  v text;
  v_out text := '';
BEGIN
  DELETE FROM user_blocks WHERE (blocker_id = c_club AND blocked_id = c_player) OR (blocker_id = c_player AND blocked_id = c_club);

  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status, description, gender)
  VALUES (c_club, 'player', '[PROBE-BLOCKS] forward wanted', 'Dublin', 'Ireland', 'open', 'Probe role description', 'Mixed')
  RETURNING id INTO o_role;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
  VALUES (o_role, c_player, 'pending') RETURNING id INTO a_app;

  -- rows/count as the club: "1/1" means listed and counted, "0/0" hidden from both.
  v := pg_temp.club_view(c_club, o_role, a_app);
  v_out := v_out || E'\n' || format('%s P1 no block: club lists and counts the applicant (%s)', CASE WHEN v = '1/1' THEN 'PASS' ELSE 'FAIL' END, v);

  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_club, c_player);
  v := pg_temp.club_view(c_club, o_role, a_app);
  v_out := v_out || E'\n' || format('%s P2 club blocked the applicant: not listed, not counted (%s)', CASE WHEN v = '0/0' THEN 'PASS' ELSE 'FAIL' END, v);
  DELETE FROM user_blocks WHERE blocker_id = c_club AND blocked_id = c_player;

  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_player, c_club);
  v := pg_temp.club_view(c_club, o_role, a_app);
  v_out := v_out || E'\n' || format('%s P3 applicant blocked the club: not listed, not counted (%s)', CASE WHEN v = '0/0' THEN 'PASS' ELSE 'FAIL' END, v);
  DELETE FROM user_blocks WHERE blocker_id = c_player AND blocked_id = c_club;

  v := pg_temp.club_view(c_club, o_role, a_app);
  v_out := v_out || E'\n' || format('%s P4 block removed: applicant back (%s)', CASE WHEN v = '1/1' THEN 'PASS' ELSE 'FAIL' END, v);

  RAISE EXCEPTION E'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
