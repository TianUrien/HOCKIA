-- Probe for 20261021200000_ambassador_invite_fences.sql: a brand can invite a
-- visible adult player, and is refused for a blocked pair, a known minor and
-- a banned player; anon cannot call it.
-- Run on STAGING only (E2E fixture ids), AFTER the migration. Everything rolls
-- back: the block ends by raising 'PROBE RESULTS'.

-- Profile changes run as the owner with no JWT (the profile guard ignores
-- age changes made in another user's name); only the invite runs as the brand.
CREATE OR REPLACE FUNCTION pg_temp.as_brand_invite(p_brand_profile uuid, p_brand uuid, p_player uuid)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_brand_profile, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_brand_profile::text, true);
  r := public.add_brand_ambassador(p_brand, p_player);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;

DO $probe$
DECLARE
  c_brand_profile constant uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';  -- E2E Test Brand
  c_brand         constant uuid := 'ec3e0984-0a69-4c81-8424-3fcba566703e';
  c_player        constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E Test Player
  v_res jsonb;
  v_out text := '';
  v_line text;
BEGIN
  DELETE FROM brand_ambassadors WHERE brand_id = c_brand AND player_id = c_player;
  DELETE FROM user_blocks WHERE (blocker_id = c_brand_profile AND blocked_id = c_player) OR (blocker_id = c_player AND blocked_id = c_brand_profile);
  UPDATE profiles SET is_blocked = false, frozen_minor_at = NULL, date_of_birth = (current_date - interval '25 years')::date, dob_required_since = NULL WHERE id = c_player;

  v_res := pg_temp.as_brand_invite(c_brand_profile, c_brand, c_player);
  v_out := v_out || E'\n' || format('%s A1 a visible adult player can be invited (%s)', CASE WHEN (v_res->>'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res);
  DELETE FROM brand_ambassadors WHERE brand_id = c_brand AND player_id = c_player;

  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (c_player, c_brand_profile);
  v_res := pg_temp.as_brand_invite(c_brand_profile, c_brand, c_player);
  v_out := v_out || E'\n' || format('%s A2 the player blocked the brand → refused (%s)', CASE WHEN v_res->>'error' = 'Player not available' THEN 'PASS' ELSE 'FAIL' END, v_res);
  DELETE FROM user_blocks WHERE blocker_id = c_player AND blocked_id = c_brand_profile;

  UPDATE profiles SET date_of_birth = (current_date - interval '16 years')::date WHERE id = c_player;
  v_res := pg_temp.as_brand_invite(c_brand_profile, c_brand, c_player);
  v_out := v_out || E'\n' || format('%s A3 a known minor → refused (%s)', CASE WHEN v_res->>'error' = 'Player not available' THEN 'PASS' ELSE 'FAIL' END, v_res);
  UPDATE profiles SET date_of_birth = (current_date - interval '25 years')::date, frozen_minor_at = NULL WHERE id = c_player;

  UPDATE profiles SET is_blocked = true WHERE id = c_player;
  v_res := pg_temp.as_brand_invite(c_brand_profile, c_brand, c_player);
  v_out := v_out || E'\n' || format('%s A4 a banned player → refused (%s)', CASE WHEN v_res->>'error' = 'Player not available' THEN 'PASS' ELSE 'FAIL' END, v_res);
  UPDATE profiles SET is_blocked = false WHERE id = c_player;

  SELECT count(*)::text INTO v_line FROM brand_ambassadors WHERE brand_id = c_brand AND player_id = c_player;
  v_out := v_out || E'\n' || format('%s A5 no invite row left by refused calls (rows=%s)', CASE WHEN v_line = '0' THEN 'PASS' ELSE 'FAIL' END, v_line);

  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM add_brand_ambassador(c_brand, c_player);
    v_line := 'FAIL B1 anon calls add_brand_ambassador → allowed';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'PASS B1 anon calls add_brand_ambassador → ' || SQLERRM; END IF;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
