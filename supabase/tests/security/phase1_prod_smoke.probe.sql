-- Production smoke test for migration 20260926100000_phase1_close_client_write_holes.
-- Runs the main user flows as the three is_test_account profiles on PRODUCTION, as the real
-- client role (SET LOCAL ROLE authenticated + JWT claims), in ONE transaction that always
-- rolls back: the final RAISE undoes every write. All outbound HTTP from triggers goes
-- through pg_net (queued rows), so a rollback also cancels every email, push and webhook.
-- Expected: every line "OK". Run before the migration (proves the test) and after.
-- N1-N3 replay the exact writes of the store apps (Android 1.17 / iOS 1.3.16, commit 14512848).
-- P1-P3 and V1 run only once migrations 20260926120000 / 20260926140000 are applied (SKIP before).

DO $smoke$
DECLARE
  c_club   constant uuid := '5ec5c6cc-2364-4079-b4cb-5d87c4430f3d';  -- e2e-club@playr.test
  c_coach  constant uuid := '70bbb9c4-462e-4805-8569-d1e2bcbfddc9';  -- e2e-coach@playr.test
  c_player constant uuid := '776c41c2-acde-454d-ae29-7364f2764fff';  -- e2e-player@playr.test
  c_conv   constant uuid := 'd41b3316-27e5-4343-a4c8-c986d09d763a';  -- club ↔ player
  v_opp uuid; v_app uuid; v_msg uuid; v_ref1 uuid; v_ref2 uuid; v_post uuid;
  v_opp2 uuid; v_app2 uuid; v_conv2 uuid; v_fgv uuid; v_opp3 uuid; v_n1 int; v_n2 int;
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

  -- ── Store apps (Android 1.17 / iOS 1.3.16, commit 14512848): their exact payloads ──
  v_step := 'N1 store app: apply without a note (ApplyToOpportunityModal payload)';
  EXECUTE 'RESET ROLE';
  INSERT INTO opportunities (club_id, title, location_city, location_country, status, opportunity_type, gender)
  VALUES (c_club, '[SMOKE] Defender', 'Test', 'Test', 'open', 'player', 'Mixed') RETURNING id INTO v_opp2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO opportunity_applications (opportunity_id, applicant_id, status)
  VALUES (v_opp2, c_player, 'pending') RETURNING id INTO v_app2;
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'N2 store app: start a new conversation (useChat payload)';
  INSERT INTO conversations (participant_one_id, participant_two_id, origin)
  VALUES (c_player, c_coach, 'Direct') RETURNING id INTO v_conv2;
  INSERT INTO messages (conversation_id, sender_id, content, idempotency_key)
  VALUES (v_conv2, c_player, 'Smoke test first message', gen_random_uuid()::text);
  v_out := v_out || E'\nOK ' || v_step;

  v_step := 'N3 store app: undo a failed first send (conversation delete)';
  DELETE FROM conversations WHERE id = v_conv2;
  v_out := v_out || E'\nOK ' || v_step;

  -- ── A withdrawn application is final ──
  v_step := 'W1 club cannot change a withdrawn application';
  EXECUTE 'RESET ROLE';
  UPDATE opportunity_applications SET status = 'withdrawn' WHERE id = v_app2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- Clubs can't see withdrawn rows (RLS), so the update matches nothing; the
  -- guard trigger's "withdrawn application cannot be changed" is defence in depth.
  UPDATE opportunity_applications SET status = 'shortlisted' WHERE id = v_app2;
  GET DIAGNOSTICS v_n1 = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  SELECT status::text INTO v_txt FROM opportunity_applications WHERE id = v_app2;
  IF v_n1 <> 0 OR v_txt <> 'withdrawn' THEN RAISE EXCEPTION 'withdrawn application changed (% rows, now %)', v_n1, v_txt; END IF;
  v_out := v_out || E'\nOK ' || v_step;

  -- ── Full-match privacy (migration 20260926120000; skipped before it) ──
  EXECUTE 'RESET ROLE';
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'full_match_visibility') THEN
    v_step := 'P1 a new full match defaults to clubs & coaches only';
    INSERT INTO player_full_game_videos (user_id, video_url, match_title)
    VALUES (c_player, 'https://youtu.be/smoke-test', '[SMOKE] full match') RETURNING id INTO v_fgv;
    SELECT visibility INTO v_txt FROM player_full_game_videos WHERE id = v_fgv;
    IF v_txt <> 'recruiters' THEN RAISE EXCEPTION 'visibility is %', v_txt; END IF;
    v_out := v_out || E'\nOK ' || v_step;

    v_step := 'P2 the club sees it, a coach who does not recruit does not';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF NOT EXISTS (SELECT 1 FROM player_full_game_videos WHERE id = v_fgv) THEN RAISE EXCEPTION 'club cannot see it'; END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF EXISTS (SELECT 1 FROM player_full_game_videos WHERE id = v_fgv) THEN RAISE EXCEPTION 'non-recruiting coach can see it'; END IF;
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\nOK ' || v_step;

    v_step := 'P3 signed-out visitors cannot see it';
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
    IF EXISTS (SELECT 1 FROM player_full_game_videos WHERE id = v_fgv) THEN RAISE EXCEPTION 'anon can see it'; END IF;
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'\nOK ' || v_step;
  ELSE
    v_out := v_out || E'\nSKIP P1-P3 full-match privacy (migration 20260926120000 not applied yet)';
  END IF;

  -- ── A role is announced once (migration 20260926140000; skipped before it) ──
  IF to_regclass('public.opportunity_first_publications') IS NOT NULL THEN
    v_step := 'V1 first publish notifies, reopening does not';
    INSERT INTO opportunities (club_id, title, location_city, location_country, status, opportunity_type, gender)
    VALUES (c_club, '[SMOKE] Goalkeeper', 'Test', 'Test', 'draft', 'player', 'Mixed') RETURNING id INTO v_opp3;
    UPDATE opportunities SET status = 'open' WHERE id = v_opp3;
    SELECT count(*) INTO v_n1 FROM profile_notifications WHERE kind = 'opportunity_published' AND source_entity_id = v_opp3;
    IF NOT EXISTS (SELECT 1 FROM opportunity_first_publications WHERE opportunity_id = v_opp3) THEN RAISE EXCEPTION 'no first-publication marker'; END IF;
    UPDATE opportunities SET status = 'closed' WHERE id = v_opp3;
    DELETE FROM profile_notifications WHERE kind = 'opportunity_published' AND source_entity_id = v_opp3;
    UPDATE opportunities SET status = 'open' WHERE id = v_opp3;
    SELECT count(*) INTO v_n2 FROM profile_notifications WHERE kind = 'opportunity_published' AND source_entity_id = v_opp3;
    IF v_n2 <> 0 THEN RAISE EXCEPTION 'reopen re-notified % people (first publish: %)', v_n2, v_n1; END IF;
    v_out := v_out || E'\nOK ' || v_step || ' (first publish notified ' || v_n1 || ')';
  ELSE
    v_out := v_out || E'\nSKIP V1 announce-once (migration 20260926140000 not applied yet)';
  END IF;

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'SMOKE RESULTS (all rolled back):%', v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'SMOKE RESULTS%' THEN RAISE; END IF;
  RAISE EXCEPTION 'SMOKE RESULTS (all rolled back):%', v_out || E'\nFAIL ' || coalesce(v_step, 'fixtures') || ': ' || SQLERRM;
END
$smoke$;
