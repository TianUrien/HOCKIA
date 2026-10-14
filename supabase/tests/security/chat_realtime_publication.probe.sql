-- Probe for 20261014160000: messages and conversations are in the realtime
-- publication, row security is still on for both, and a member who is not a
-- participant cannot read a thread's rows (Realtime applies the same SELECT
-- policies before delivering a change). Run on STAGING via execute_sql; the
-- final RAISE rolls everything back.

DO $probe$
DECLARE
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- E2E club
  c_other  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';  -- E2E coach (not a participant)
  v_conv uuid; v_n int; v_out text := '';
BEGIN
  -- A publication membership
  SELECT count(*) INTO v_n FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('messages', 'conversations');
  v_out := v_out || E'\n' || format('%s A both chat tables in supabase_realtime → %s of 2', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- B row security still on
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('messages', 'conversations') AND c.relrowsecurity;
  v_out := v_out || E'\n' || format('%s B RLS enabled on both → %s of 2', CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- fixture: the E2E player ↔ club thread (exists on staging)
  SELECT id INTO v_conv FROM conversations
  WHERE (participant_one_id, participant_two_id) IN ((c_player, c_club), (c_club, c_player)) LIMIT 1;

  -- C a participant reads the thread's messages
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM messages WHERE conversation_id = v_conv;
  v_out := v_out || E'\n' || format('%s C participant reads the thread → %s row(s)', CASE WHEN v_n > 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXECUTE 'RESET ROLE';

  -- D a non-participant reads nothing (messages and the conversation row)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM messages WHERE conversation_id = v_conv;
  v_out := v_out || E'\n' || format('%s D1 non-participant reads messages → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  SELECT count(*) INTO v_n FROM conversations WHERE id = v_conv;
  v_out := v_out || E'\n' || format('%s D2 non-participant reads the conversation → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXECUTE 'RESET ROLE';

  -- E anon reads nothing
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v_n FROM messages WHERE conversation_id = v_conv;
  v_out := v_out || E'\n' || format('%s E anon reads messages → %s row(s)', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
