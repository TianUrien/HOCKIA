-- Probe for 20261118170000: create_user_post has its three gates again
-- (video kind = 'post', launch flag on new video items, 10 posts/hour).
-- Run on STAGING only (fixture ids are the E2E accounts there) via execute_sql.
-- Identities are switched with SET LOCAL ROLE authenticated + request.jwt.claims.
-- Everything happens in one transaction that the final RAISE rolls back.

DO $probe$
DECLARE
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player (test account)
  v_post uuid; v_reel uuid; v_highlight uuid; v_other uuid;
  v_res jsonb; v_ok int := 0; i int;
  v_out text := '';

BEGIN
  -- ── fixtures (sys) ──
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO player_videos (user_id, kind, title, visibility, status) VALUES (c_player, 'post', 'probe post video', 'public', 'ready') RETURNING id INTO v_post;
  INSERT INTO player_videos (user_id, kind, title, visibility, status) VALUES (c_player, 'reel', 'probe reel', 'public', 'ready') RETURNING id INTO v_reel;
  INSERT INTO player_videos (user_id, kind, title, visibility, status) VALUES (c_player, 'highlight', 'probe highlight', 'public', 'ready') RETURNING id INTO v_highlight;
  INSERT INTO player_videos (user_id, kind, title, visibility, status) VALUES (c_coach, 'post', 'probe other member', 'public', 'ready') RETURNING id INTO v_other;
  INSERT INTO app_settings (key, value) VALUES ('video_posts_enabled', 'true')
    ON CONFLICT (key) DO UPDATE SET value = 'true';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- A1 flag on, own public post video → accepted
  v_res := create_user_post('Probe video post', jsonb_build_array(jsonb_build_object('media_type', 'video', 'video_id', v_post, 'order', 0)));
  v_out := v_out || E'\n' || format('%s A1 own post video accepted → %s', CASE WHEN (v_res ->> 'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');

  -- A2 a Gallery reel is refused
  v_res := create_user_post('Probe reel', jsonb_build_array(jsonb_build_object('media_type', 'video', 'video_id', v_reel, 'order', 0)));
  v_out := v_out || E'\n' || format('%s A2 gallery reel refused → %s', CASE WHEN NOT (v_res ->> 'success')::boolean AND v_res ->> 'error' LIKE '%not a public post video%' THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');

  -- A3 a profile highlight is refused
  v_res := create_user_post('Probe highlight', jsonb_build_array(jsonb_build_object('media_type', 'video', 'video_id', v_highlight, 'order', 0)));
  v_out := v_out || E'\n' || format('%s A3 profile highlight refused → %s', CASE WHEN NOT (v_res ->> 'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');

  -- A4 another member's post video is refused
  v_res := create_user_post('Probe other', jsonb_build_array(jsonb_build_object('media_type', 'video', 'video_id', v_other, 'order', 0)));
  v_out := v_out || E'\n' || format('%s A4 another member''s video refused → %s', CASE WHEN NOT (v_res ->> 'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');

  -- B1 flag off → a new video post is refused, text still posts
  EXECUTE 'RESET ROLE';
  UPDATE app_settings SET value = 'false' WHERE key = 'video_posts_enabled';
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_res := create_user_post('Probe flag off', jsonb_build_array(jsonb_build_object('media_type', 'video', 'video_id', v_post, 'order', 0)));
  v_out := v_out || E'\n' || format('%s B1 flag off, video refused → %s', CASE WHEN NOT (v_res ->> 'success')::boolean AND v_res ->> 'error' LIKE '%not available yet%' THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');
  v_res := create_user_post('Probe flag off text only', NULL);
  v_out := v_out || E'\n' || format('%s B2 flag off, text post accepted → %s', CASE WHEN (v_res ->> 'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');

  -- C1 post types: a question needs text, an unknown type is refused
  v_res := create_user_post('', jsonb_build_array(jsonb_build_object('media_type', 'image', 'url', 'https://example.com/a.jpg', 'order', 0)), 'question');
  v_out := v_out || E'\n' || format('%s C1 question without text refused → %s', CASE WHEN NOT (v_res ->> 'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');
  v_res := create_user_post('Probe type', NULL, 'signing');
  v_out := v_out || E'\n' || format('%s C2 announcement type refused → %s', CASE WHEN NOT (v_res ->> 'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');

  -- D1 a test account is not rate limited (12 posts)
  v_ok := 0;
  FOR i IN 1..12 LOOP
    v_res := create_user_post('Probe test account ' || i, NULL);
    IF (v_res ->> 'success')::boolean THEN v_ok := v_ok + 1; END IF;
  END LOOP;
  v_out := v_out || E'\n' || format('%s D1 test account posts 12 times → %s accepted', CASE WHEN v_ok = 12 THEN 'PASS' ELSE 'FAIL' END, v_ok);

  -- D2 a real account is stopped after 10 posts in the hour. now() does not
  -- move inside one transaction and rate_limits is unique on its timestamp,
  -- so nine earlier posts are seeded and only the 10th and 11th are real calls.
  EXECUTE 'RESET ROLE';
  UPDATE profiles SET is_test_account = false WHERE id = c_player;
  DELETE FROM rate_limits WHERE identifier = c_player::text AND action_type = 'create_post';
  INSERT INTO rate_limits (identifier, action_type, created_at)
  SELECT c_player::text, 'create_post', now() - make_interval(mins => g) FROM generate_series(1, 9) g;
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_res := create_user_post('Probe real account tenth', NULL);
  v_out := v_out || E'\n' || format('%s D2 real account, 10th post in the hour accepted → %s', CASE WHEN (v_res ->> 'success')::boolean THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');
  v_res := create_user_post('Probe real account eleventh', NULL);
  v_out := v_out || E'\n' || format('%s D3 real account, 11th refused → %s', CASE WHEN NOT (v_res ->> 'success')::boolean AND v_res ->> 'error' LIKE 'Rate limit exceeded%' THEN 'PASS' ELSE 'FAIL' END, v_res ->> 'error');

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION E'PROBE RESULTS (rolled back):%', v_out;
END
$probe$;
