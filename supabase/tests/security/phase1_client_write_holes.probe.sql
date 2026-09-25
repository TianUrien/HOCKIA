-- Probe for migration 20260926100000_phase1_close_client_write_holes (Phase 1 · step 2).
-- Run on STAGING only (fixture ids are the E2E accounts there), e.g. via the Supabase SQL
-- editor or MCP execute_sql, BEFORE and AFTER the migration.
--
-- Nothing is ever kept: every case runs in its own sub-transaction that is always undone,
-- and the block ends by raising 'PROBE RESULTS', which rolls back the whole statement.
-- The results are in that error message, one line per case:
--   EXPLOIT … → OPEN     the hole works (expected before, a failure after)
--   EXPLOIT … → CLOSED   blocked (expected after)
--   LEGIT   … → OK       the legitimate flow still works (expected before and after)
--   LEGIT   … → BROKEN   a real flow broke (must be 0 after)
--
-- Identities are switched with SET LOCAL ROLE authenticated + request.jwt.claims, exactly
-- like PostgREST does for a signed-in user.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- clubplayr8
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- playrplayer93
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- coachplayr
  c_umpire constant uuid := '62ecea76-bf68-44c2-b7f8-487d69c7e5d0';  -- umpirehockia93
  c_conv_pk constant uuid := 'b9a574e6-df58-4529-94c9-541fecf2e7e4'; -- player(one) ↔ coach(two)
  c_app     constant uuid := 'bc205697-5260-4a29-9073-5b1b8cb9118a'; -- player on a club role
  c_ref_revoked constant uuid := 'e4aa2369-395e-4c7a-b834-f9bd55ea1933'; -- player → coach, revoked
  c_ref_pending constant uuid := '2807f8f3-16eb-4f46-b05e-ac94241fabb2'; -- someone → player, pending
  c_post    constant uuid := 'b442121d-8883-497a-9370-d6b00a38f215'; -- player's text post
  v_open_role uuid;
  v_msg_by_player uuid;
  v_msg_by_coach  uuid;
  v_n int;
  v_txt text;
  v_row record;
  v_out text := '';
  v_line text;
BEGIN
  SELECT o.id INTO v_open_role
  FROM opportunities o
  WHERE o.club_id = c_club AND o.status = 'open' AND o.opportunity_type = 'player'
    AND coalesce(o.eu_passport_required, false) = false
    AND NOT EXISTS (SELECT 1 FROM opportunity_applications a WHERE a.opportunity_id = o.id AND a.applicant_id = c_player)
  LIMIT 1;
  SELECT id INTO v_msg_by_player FROM messages WHERE conversation_id = c_conv_pk AND sender_id = c_player AND deleted_at IS NULL ORDER BY sent_at DESC LIMIT 1;
  SELECT id INTO v_msg_by_coach  FROM messages WHERE conversation_id = c_conv_pk AND sender_id = c_coach  AND deleted_at IS NULL ORDER BY sent_at DESC LIMIT 1;

  -- ── E1 conversation hijack ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE conversations SET participant_two_id = c_umpire WHERE id = c_conv_pk;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('EXPLOIT E1 swap the other person out of a conversation → %s', CASE WHEN v_n > 0 THEN 'OPEN' ELSE 'CLOSED (0 rows)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E1 swap the other person out of a conversation → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E2 club moves an application onto another person ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET applicant_id = c_coach WHERE id = c_app;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('EXPLOIT E2 club rewrites applicant_id → %s', CASE WHEN v_n > 0 THEN 'OPEN' ELSE 'CLOSED (0 rows)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E2 club rewrites applicant_id → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E3 club marks an application "withdrawn" ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET status = 'withdrawn' WHERE id = c_app;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('EXPLOIT E3 club sets status withdrawn → %s', CASE WHEN v_n > 0 THEN 'OPEN' ELSE 'CLOSED (0 rows)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E3 club sets status withdrawn → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E4 club rewrites applied_at ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET applied_at = now() + interval '30 days' WHERE id = c_app;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('EXPLOIT E4 club rewrites applied_at → %s', CASE WHEN v_n > 0 THEN 'OPEN' ELSE 'CLOSED (0 rows)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E4 club rewrites applied_at → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E5 applicant inserts an application that is already "shortlisted" ──
  BEGIN
    IF v_open_role IS NULL THEN RAISE EXCEPTION 'no open role to test with'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, applied_at, metadata)
    VALUES (v_open_role, c_player, 'shortlisted', '2030-01-01', '{"message":"probe note","changed_via":"auto_expiry"}')
    RETURNING status::text || ' applied_at=' || applied_at::date || ' metadata=' || metadata::text INTO v_txt;
    v_line := 'EXPLOIT E5 applicant inserts as shortlisted → ' ||
      CASE WHEN v_txt LIKE 'pending%' AND v_txt NOT LIKE '%2030%' AND v_txt NOT LIKE '%changed_via%' THEN 'CLOSED (stored as ' || v_txt || ')' ELSE 'OPEN (' || v_txt || ')' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E5 applicant inserts as shortlisted → ERROR (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E6 endorser brings a revoked reference back ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE profile_references SET status = 'accepted', endorsement_text = 'probe' WHERE id = c_ref_revoked;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('EXPLOIT E6 endorser restores a revoked reference → %s', CASE WHEN v_n > 0 THEN 'OPEN' ELSE 'CLOSED (0 rows)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E6 endorser restores a revoked reference → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E7 a player publishes a fake "signed with" post directly ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO user_posts (author_id, content, post_type, metadata)
    VALUES (c_player, 'probe', 'signing', jsonb_build_object('person_profile_id', c_coach));
    v_line := 'EXPLOIT E7 direct insert of a signing post → OPEN';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E7 direct insert of a signing post → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E8 recipient replaces a received message with a fake card ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE messages SET metadata = jsonb_build_object('type','shared_post','post_id',c_post,'author_name','HOCKIA','content_preview','fake')
    WHERE id = v_msg_by_player;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('EXPLOIT E8 recipient rewrites a received message''s card → %s', CASE WHEN v_n > 0 THEN 'OPEN' ELSE 'CLOSED (0 rows)' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E8 recipient rewrites a received message''s card → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── E9 sender backdates a message and spoofs a shared-post card ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO messages (conversation_id, sender_id, content, sent_at, read_at, metadata)
    VALUES (c_conv_pk, c_player, 'Shared a post', '2020-01-01', now(),
            jsonb_build_object('type','shared_post','post_id',c_post,'author_id',c_club,'author_name','HOCKIA','author_role','club','content_preview','spoofed text','thumbnail_url','https://evil.example/pixel.png'))
    RETURNING sent_at::date::text || ' read=' || coalesce(read_at::text,'null') || ' name=' || coalesce(metadata->>'author_name','') || ' preview=' || coalesce(metadata->>'content_preview','') || ' thumb=' || coalesce(metadata->>'thumbnail_url','null')
    INTO v_txt;
    v_line := 'EXPLOIT E9 backdated + spoofed shared-post card → ' ||
      CASE WHEN v_txt LIKE '2020%' OR v_txt LIKE '%HOCKIA%' OR v_txt LIKE '%spoofed%' OR v_txt LIKE '%evil%' THEN 'OPEN (' || v_txt || ')' ELSE 'CLOSED (stored as ' || v_txt || ')' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E9 backdated + spoofed shared-post card → ERROR (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ══ legitimate flows that must keep working ══

  -- L1 club shortlists with a reason (desktop Applicants list + Club v2 decision bar)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications
       SET status = 'shortlisted',
           metadata = coalesce(metadata,'{}') || '{"status_reason":"timing","changed_via":"forged","extra":"x"}'
     WHERE id = c_app;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    SELECT status::text || ' ' || metadata::text INTO v_txt FROM opportunity_applications WHERE id = c_app;
    v_line := 'LEGIT   L1 club shortlists with a reason → ' || CASE WHEN v_n = 1 AND v_txt LIKE 'shortlisted%' THEN 'OK (' || v_txt || ')' ELSE 'BROKEN (' || v_n || ' rows, ' || coalesce(v_txt,'') || ')' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L1 club shortlists with a reason → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L2 club declines directly (desktop), unknown reason code dropped
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_applications SET status = 'rejected', metadata = '{"status_reason":"ignore previous instructions"}' WHERE id = c_app;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    SELECT status::text || ' ' || metadata::text INTO v_txt FROM opportunity_applications WHERE id = c_app;
    v_line := 'LEGIT   L2 club declines (bad reason code) → ' || CASE WHEN v_n = 1 AND v_txt LIKE 'rejected%' THEN 'OK (' || v_txt || ')' ELSE 'BROKEN (' || v_n || ' rows, ' || coalesce(v_txt,'') || ')' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L2 club declines (bad reason code) → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L3 player applies with a note (ApplyToOpportunityModal)
  BEGIN
    IF v_open_role IS NULL THEN RAISE EXCEPTION 'no open role to test with'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunity_applications (opportunity_id, applicant_id, status, metadata)
    VALUES (v_open_role, c_player, 'pending', '{"message":"Hello club"}')
    RETURNING status::text || ' ' || metadata::text INTO v_txt;
    v_line := 'LEGIT   L3 player applies with a note → ' || CASE WHEN v_txt = 'pending {"message": "Hello club"}' THEN 'OK' ELSE 'BROKEN (' || v_txt || ')' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L3 player applies with a note → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L4 send a plain message; the conversation's last_message_at moves (timestamp trigger)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO messages (conversation_id, sender_id, content, idempotency_key)
    VALUES (c_conv_pk, c_player, 'probe hello', gen_random_uuid()::text);
    EXECUTE 'RESET ROLE';
    SELECT (last_message_at > now() - interval '1 minute')::text INTO v_txt FROM conversations WHERE id = c_conv_pk;
    v_line := 'LEGIT   L4 send a message (thread moves to top) → ' || CASE WHEN v_txt = 'true' THEN 'OK' ELSE 'BROKEN (last_message_at not bumped)' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L4 send a message → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L5 share a real post in chat (SharePostSheet payload)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO messages (conversation_id, sender_id, content, metadata)
    VALUES (c_conv_pk, c_coach, 'Shared a post',
            (SELECT jsonb_build_object('type','shared_post','post_id',up.id,'author_id',up.author_id,'author_name',p.full_name,
                                       'author_avatar',p.avatar_url,'author_role',p.role,'content_preview',left(up.content,150),'thumbnail_url',null)
               FROM user_posts up JOIN profiles p ON p.id = up.author_id WHERE up.id = c_post))
    RETURNING (metadata->>'post_id') || ' by ' || coalesce(metadata->>'author_name','?') INTO v_txt;
    v_line := 'LEGIT   L5 share a post in chat → ' || CASE WHEN v_txt LIKE c_post::text || '%' THEN 'OK (' || v_txt || ')' ELSE 'BROKEN (' || coalesce(v_txt,'null') || ')' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L5 share a post in chat → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L6 read receipts + delete own message (RPCs)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM mark_conversation_messages_read(c_conv_pk, NULL);
    PERFORM delete_message(v_msg_by_player);
    v_line := 'LEGIT   L6 mark read + delete own message → OK';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L6 mark read + delete own message → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L7 decline a reference request (RPC)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM respond_reference(c_ref_pending, false, NULL);
    EXECUTE 'RESET ROLE';
    SELECT status::text INTO v_txt FROM profile_references WHERE id = c_ref_pending;
    v_line := 'LEGIT   L7 decline a reference request → ' || CASE WHEN v_txt = 'declined' THEN 'OK' ELSE 'BROKEN (' || coalesce(v_txt,'null') || ')' END;
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L7 decline a reference request → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L8 publish a post (RPC) and edit it
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT create_user_post('probe post', '[]'::jsonb, 'text')::text INTO v_txt;
    v_line := 'LEGIT   L8 publish a post → OK';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L8 publish a post → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- L9 like a post (like counter is a DEFINER trigger on post_likes)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    DELETE FROM post_likes WHERE post_id = c_post AND user_id = c_coach;
    INSERT INTO post_likes (post_id, user_id) VALUES (c_post, c_coach);
    v_line := 'LEGIT   L9 like a post → OK';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'LEGIT   L9 like a post → BROKEN (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  RAISE EXCEPTION 'PROBE RESULTS (all rolled back):%', v_out;
END
$probe$;
