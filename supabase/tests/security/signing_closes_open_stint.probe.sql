-- Probe for 20261106230000_signing_closes_open_stint.sql: a confirmed signing ends
-- the open stint at the same organisation and nothing else.
--
-- Run on STAGING only (fixture ids are the E2E accounts there), AFTER the migration.
-- Nothing is kept: the block ends by raising 'PROBE RESULTS', which rolls back.
-- One line per case: PASS <case> → <detail> | FAIL <case> → <detail>.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club (publisher)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (signs)
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (someone else)
  v_today  constant date := timezone('utc', now())::date;
  o_new uuid; a_new uuid; ch_new uuid;
  ch_same uuid; ch_other uuid; ch_samenow uuid; ch_coach uuid;
  v_out text := '';
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status,
                             start_date, organization_name)
  VALUES (c_club, 'player', '[PROBE] renewal', 'Dublin', 'Ireland', 'open', v_today, '[PROBE] Renew FC')
  RETURNING id INTO o_new;
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, signing_requested_at, signing_close_role)
  VALUES (o_new, c_player, 'signed_pending_confirmation', timezone('utc', now()), false) RETURNING id INTO a_new;

  -- the stint already open at the same club (by name), one at another club, a same-day
  -- duplicate, and another member's open stint at the same club
  INSERT INTO career_history (user_id, club_name, position_role, years, division_league, start_date, entry_type)
  VALUES (c_player, '[probe] renew fc ', 'Midfielder', '2025–26', '', v_today - 300, 'club') RETURNING id INTO ch_same;
  INSERT INTO career_history (user_id, club_name, position_role, years, division_league, start_date, entry_type)
  VALUES (c_player, '[PROBE] Other FC', 'Midfielder', '2025–26', '', v_today - 300, 'club') RETURNING id INTO ch_other;
  INSERT INTO career_history (user_id, club_name, position_role, years, division_league, start_date, entry_type)
  VALUES (c_player, '[PROBE] Renew FC', 'Midfielder', '2026–27', '', v_today, 'club') RETURNING id INTO ch_samenow;
  INSERT INTO career_history (user_id, club_name, position_role, years, division_league, start_date, entry_type)
  VALUES (c_coach, '[PROBE] Renew FC', 'Head coach', '2025–26', '', v_today - 300, 'club') RETURNING id INTO ch_coach;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (confirm_signing(a_new, false) ->> 'career_entry_id')::uuid INTO ch_new;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);

  v_out := v_out || E'\n' || format('%s A1 open stint at the same club ends the day before → end %s',
    CASE WHEN (SELECT end_date FROM career_history WHERE id = ch_same) = v_today - 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT end_date FROM career_history WHERE id = ch_same));
  v_out := v_out || E'\n' || format('%s A2 the new signing stays open → end %s',
    CASE WHEN ch_new IS NOT NULL AND (SELECT end_date FROM career_history WHERE id = ch_new) IS NULL THEN 'PASS' ELSE 'FAIL' END,
    (SELECT end_date FROM career_history WHERE id = ch_new));
  v_out := v_out || E'\n' || format('%s B1 another club is untouched → end %s',
    CASE WHEN (SELECT end_date FROM career_history WHERE id = ch_other) IS NULL THEN 'PASS' ELSE 'FAIL' END,
    (SELECT end_date FROM career_history WHERE id = ch_other));
  v_out := v_out || E'\n' || format('%s B2 a same-day stint is left alone → end %s',
    CASE WHEN (SELECT end_date FROM career_history WHERE id = ch_samenow) IS NULL THEN 'PASS' ELSE 'FAIL' END,
    (SELECT end_date FROM career_history WHERE id = ch_samenow));
  v_out := v_out || E'\n' || format('%s B3 another member''s stint is untouched → end %s',
    CASE WHEN (SELECT end_date FROM career_history WHERE id = ch_coach) IS NULL THEN 'PASS' ELSE 'FAIL' END,
    (SELECT end_date FROM career_history WHERE id = ch_coach));

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
