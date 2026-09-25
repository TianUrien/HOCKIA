-- Production smoke test for migration 20260926100000_phase1_close_client_write_holes.
-- Runs the main user flows as the three is_test_account profiles on PRODUCTION, as the real
-- client role (SET LOCAL ROLE authenticated + JWT claims), in ONE transaction that always
-- rolls back: the final RAISE undoes every write. All outbound HTTP from triggers goes
-- through pg_net (queued rows), so a rollback also cancels every email, push and webhook.
-- Expected: every line "OK". Run before the migration (proves the test) and after.

DO $smoke$
DECLARE
  c_club   constant uuid := '5ec5c6cc-2364-4079-b4cb-5d87c4430f3d';  -- e2e-club@playr.test
  c_coach  constant uuid := '70bbb9c4-462e-4805-8569-d1e2bcbfddc9';  -- e2e-coach@playr.test
  c_player constant uuid := '776c41c2-acde-454d-ae29-7364f2764fff';  -- e2e-player@playr.test
  c_conv   constant uuid := 'd41b3316-27e5-4343-a4c8-c986d09d763a';  -- club ↔ player
  v_opp uuid; v_app uuid; v_msg uuid; v_ref1 uuid; v_ref2 uuid; v_post uuid;
  v_txt text; v_out text := ''; v_step text;
BEGIN
  -- fixtures (as the migration owner; rolled back with everything else)
  INSERT INTO opportunities (club_id, title, location_city, location_country, status, opportunity_type, gender)
  VALUES (c_club, '[SMOKE] Midfielder', 'Test', 'Test', 'open', 'player', 'Mixed')
  RETURNING id INTO v_opp;
  INSERT INTO profile_friendships (user_one, user_two, requester_id, status, accepted_at)
  VALUES (least(c_player, c_coach), greatest(c_player, c_coach), c_player, 'accepted', now()),
         (least(c_player, c_club),  greatest(c_player, c_club),  c_player, 'accepted', now());

  v_step := 'S1 player applies with a note';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, metadata)
  VALUES (v_opp, c_player, 'pending', '{"message":"Smoke test note"}') RETURNING id INTO v_app;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S2 club shortlists with a reason';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE opportunity_applications SET status = 'shortlisted', metadata = '{"message":"Smoke test note","status_reason":null}' WHERE id = v_app;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S3 club declines with a reason (desktop path; Club v2 declines via the edge function)';
  UPDATE opportunity_applications SET status = 'rejected', metadata = '{"message":"Smoke test note","status_reason":"timing"}' WHERE id = v_app;
  EXECUTE 'RESET ROLE';
  SELECT status::text || ' ' || metadata::text INTO v_txt FROM opportunity_applications WHERE id = v_app;
  IF v_txt NOT LIKE 'rejected%timing%' THEN RAISE EXCEPTION 'decline not stored: %', v_txt; END IF;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S4 club and player exchange messages';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO messages (conversation_id, sender_id, content, idempotency_key)
  VALUES (c_conv, c_club, 'Smoke test from club', gen_random_uuid()::text);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO messages (conversation_id, sender_id, content, idempotency_key)
  VALUES (c_conv, c_player, 'Smoke test reply', gen_random_uuid()::text) RETURNING id INTO v_msg;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S5 player asks two friends for references';
  SELECT (request_reference(c_coach, 'coach', 'Smoke test')).id INTO v_ref1;
  SELECT (request_reference(c_club, 'club staff', 'Smoke test')).id INTO v_ref2;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S6 coach writes a reference';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM respond_reference(v_ref1, true, 'Smoke test endorsement');
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S7 club declines a reference request';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM respond_reference(v_ref2, false, NULL);
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S8 player publishes a post';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM create_user_post('[SMOKE] test post', '[]'::jsonb, 'text');
  EXECUTE 'RESET ROLE';
  SELECT id INTO v_post FROM user_posts WHERE author_id = c_player AND content = '[SMOKE] test post' ORDER BY created_at DESC LIMIT 1;
  IF v_post IS NULL THEN RAISE EXCEPTION 'post not created'; END IF;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S9 coach likes the post';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, c_coach);
  EXECUTE 'RESET ROLE';
  SELECT like_count::text INTO v_txt FROM user_posts WHERE id = v_post;
  IF v_txt <> '1' THEN RAISE EXCEPTION 'like_count is %', v_txt; END IF;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S10 club shares the post in chat';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO messages (conversation_id, sender_id, content, metadata)
  SELECT c_conv, c_club, 'Shared a post',
         jsonb_build_object('type','shared_post','post_id',up.id,'author_id',up.author_id,'author_name',p.full_name,
                            'author_avatar',p.avatar_url,'author_role',p.role,'content_preview',left(up.content,150),'thumbnail_url',null)
  FROM user_posts up JOIN profiles p ON p.id = up.author_id WHERE up.id = v_post
  RETURNING metadata->>'post_id' INTO v_txt;
  IF v_txt IS DISTINCT FROM v_post::text THEN RAISE EXCEPTION 'shared card wrong: %', v_txt; END IF;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'S11 player reads the thread and deletes a message';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM mark_conversation_messages_read(c_conv, NULL);
  PERFORM delete_message(v_msg);
  v_out := v_out || E'\nOK ' || v_step;

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'SMOKE RESULTS (all rolled back):%', v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'SMOKE RESULTS%' THEN RAISE; END IF;
  RAISE EXCEPTION 'SMOKE RESULTS (all rolled back):%', v_out || E'\nFAIL ' || coalesce(v_step, 'fixtures') || ': ' || SQLERRM;
END
$smoke$;
