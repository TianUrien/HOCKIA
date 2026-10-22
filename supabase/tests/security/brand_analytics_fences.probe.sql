-- Probe for 20261022120000_brand_analytics_fences.sql: the brand's profile
-- views count only real viewers (not the brand itself, test accounts, hidden
-- viewers or a blocked pair), and hidden ambassadors are not counted.
-- Run on STAGING only (E2E fixture ids), AFTER the migration. Everything rolls
-- back: the block ends by raising 'PROBE RESULTS'.

CREATE OR REPLACE FUNCTION pg_temp.as_brand_stats(p_brand_profile uuid)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_brand_profile, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_brand_profile::text, true);
  r := public.get_my_brand_analytics(30);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;

DO $probe$
DECLARE
  c_brand_profile constant uuid := 'b2f1cff7-f71b-44ec-8086-d5e22bed27fd';  -- E2E Test Brand
  c_brand         constant uuid := 'ec3e0984-0a69-4c81-8424-3fcba566703e';
  c_test_player   constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E Test Player (test account)
  v_real uuid;
  v_base jsonb; v_res jsonb;
  v_views0 bigint; v_amb0 bigint;
  v_out text := '';
BEGIN
  -- A visible, non-test, onboarded player who has not blocked the brand.
  SELECT p.id INTO v_real FROM profiles p
   WHERE p.role = 'player' AND NOT p.is_test_account AND p.onboarding_completed
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
     AND NOT public.is_blocked_pair(p.id, c_brand_profile)
   ORDER BY p.created_at LIMIT 1;
  IF v_real IS NULL THEN RAISE EXCEPTION 'PROBE RESULTS:%', E'\nFAIL setup: no visible non-test player on staging'; END IF;

  v_base := pg_temp.as_brand_stats(c_brand_profile);
  v_views0 := (v_base->>'profile_views')::bigint;
  v_amb0 := (v_base->>'ambassador_count')::bigint;

  -- One view each from: a real viewer, the brand itself, a test account, an anonymous visitor.
  INSERT INTO events (event_name, user_id, entity_type, entity_id, created_at) VALUES
    ('profile_view', v_real,          'profile', c_brand_profile, now()),
    ('profile_view', c_brand_profile, 'profile', c_brand_profile, now()),
    ('profile_view', c_test_player,   'profile', c_brand_profile, now()),
    ('profile_view', NULL,            'profile', c_brand_profile, now());
  v_res := pg_temp.as_brand_stats(c_brand_profile);
  v_out := v_out || E'\n' || format('%s A1 only the real viewer counts (views %s → %s, expected +1)',
    CASE WHEN (v_res->>'profile_views')::bigint = v_views0 + 1 THEN 'PASS' ELSE 'FAIL' END, v_views0, v_res->>'profile_views');

  UPDATE profiles SET is_blocked = true WHERE id = v_real;
  v_res := pg_temp.as_brand_stats(c_brand_profile);
  v_out := v_out || E'\n' || format('%s A2 a banned viewer is not counted (views %s, expected %s)',
    CASE WHEN (v_res->>'profile_views')::bigint = v_views0 THEN 'PASS' ELSE 'FAIL' END, v_res->>'profile_views', v_views0);
  UPDATE profiles SET is_blocked = false WHERE id = v_real;

  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (v_real, c_brand_profile);
  v_res := pg_temp.as_brand_stats(c_brand_profile);
  v_out := v_out || E'\n' || format('%s A3 a blocked pair is not counted (views %s, expected %s)',
    CASE WHEN (v_res->>'profile_views')::bigint = v_views0 THEN 'PASS' ELSE 'FAIL' END, v_res->>'profile_views', v_views0);
  DELETE FROM user_blocks WHERE blocker_id = v_real AND blocked_id = c_brand_profile;

  -- Ambassadors: an accepted ambassador counts until hidden.
  DELETE FROM brand_ambassadors WHERE brand_id = c_brand AND player_id = v_real;
  -- Baseline after removing any existing row for this player (it may already be an ambassador).
  v_amb0 := (pg_temp.as_brand_stats(c_brand_profile)->>'ambassador_count')::bigint;
  INSERT INTO brand_ambassadors (brand_id, player_id, status) VALUES (c_brand, v_real, 'accepted');
  v_res := pg_temp.as_brand_stats(c_brand_profile);
  v_out := v_out || E'\n' || format('%s B1 a visible accepted ambassador counts (%s → %s)',
    CASE WHEN (v_res->>'ambassador_count')::bigint = v_amb0 + 1 THEN 'PASS' ELSE 'FAIL' END, v_amb0, v_res->>'ambassador_count');
  UPDATE profiles SET is_blocked = true WHERE id = v_real;
  v_res := pg_temp.as_brand_stats(c_brand_profile);
  v_out := v_out || E'\n' || format('%s B2 a hidden ambassador is not counted (%s, expected %s)',
    CASE WHEN (v_res->>'ambassador_count')::bigint = v_amb0 THEN 'PASS' ELSE 'FAIL' END, v_res->>'ambassador_count', v_amb0);

  -- Shape unchanged.
  v_out := v_out || E'\n' || format('%s C1 response keeps every field (%s)',
    CASE WHEN v_res ?& ARRAY['success','profile_views','profile_views_previous','follower_count','product_count','post_count','ambassador_count'] THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(v_res) k));

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
