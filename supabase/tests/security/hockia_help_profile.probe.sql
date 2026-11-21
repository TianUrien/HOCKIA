-- Probe for 20261121130000_hockia_help_profile.sql: hockia_help_profile_id()
-- returns the help account only to a member who could open a chat with it.
--
-- Run on STAGING only, via the SQL editor or MCP execute_sql, AFTER the
-- migration. Nothing is ever kept: the block ends by raising 'PROBE RESULTS',
-- which rolls back the whole statement.
--
-- One line per case:   PASS <case> -> <detail>   |   FAIL <case> -> <detail>
-- Every line must be PASS.
--
-- The help account is the first brand profile; the member is the first
-- onboarded adult player who is not hidden. Fixture rows are forced into
-- shape inside the rolled-back transaction.

DO $probe$
DECLARE
  v_help uuid; v_me uuid; v_got uuid; v_out text := '';
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT b.profile_id INTO v_help FROM public.brands b JOIN public.profiles p ON p.id = b.profile_id
   WHERE b.deleted_at IS NULL AND NOT coalesce(p.is_blocked, false) LIMIT 1;
  SELECT p.id INTO v_me FROM public.profiles p
   WHERE p.role = 'player' AND p.id <> v_help AND coalesce(p.onboarding_completed, false)
     AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
   LIMIT 1;
  UPDATE public.profiles SET onboarding_completed = true, is_test_account = false, created_at = now() - interval '60 days' WHERE id IN (v_help, v_me);
  DELETE FROM public.user_blocks WHERE (blocker_id = v_me AND blocked_id = v_help) OR (blocker_id = v_help AND blocked_id = v_me);
  DELETE FROM public.conversations c WHERE (c.participant_one_id = v_me AND c.participant_two_id = v_help) OR (c.participant_one_id = v_help AND c.participant_two_id = v_me);
  DELETE FROM public.new_conversation_log WHERE user_id = v_me;
  DELETE FROM public.app_settings WHERE key = 'hockia_help_profile_id';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

  v_got := public.hockia_help_profile_id();
  v_out := v_out || CASE WHEN v_got IS NULL THEN 'PASS' ELSE 'FAIL' END || E' A1 no row -> NULL\n';

  INSERT INTO public.app_settings (key, value) VALUES ('hockia_help_profile_id', upper(v_help::text));
  v_got := public.hockia_help_profile_id();
  v_out := v_out || CASE WHEN v_got = v_help THEN 'PASS' ELSE 'FAIL' END || E' A2 set (upper-case uuid) -> the help account\n';

  UPDATE public.app_settings SET value = 'not-a-uuid' WHERE key = 'hockia_help_profile_id';
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' A3 malformed value -> NULL\n';
  UPDATE public.app_settings SET value = v_help::text WHERE key = 'hockia_help_profile_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_help, 'role', 'authenticated')::text, true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' B1 the help account itself -> NULL\n';
  PERFORM set_config('request.jwt.claims', '', true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' B2 no session -> NULL\n';

  UPDATE public.profiles SET is_blocked = true WHERE id = v_help;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' C1 help account hidden -> NULL\n';
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET is_blocked = false, onboarding_completed = false WHERE id = v_help;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' C2 help account not onboarded -> NULL\n';
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET onboarding_completed = true WHERE id = v_help;

  UPDATE public.profiles SET onboarding_completed = false WHERE id = v_me;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' D1 member not onboarded -> NULL\n';
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.profiles SET onboarding_completed = true WHERE id = v_me;

  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_help, v_me);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' D2 blocked by the help account -> NULL\n';
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.user_blocks WHERE blocker_id = v_help AND blocked_id = v_me;

  -- The daily allowance (15 for an account older than a week) is used up with other people.
  INSERT INTO public.new_conversation_log (user_id, other_user_id, created_at)
  SELECT v_me, p.id, now() - interval '1 hour' FROM public.profiles p WHERE p.id NOT IN (v_me, v_help) LIMIT 15;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() IS NULL THEN 'PASS' ELSE 'FAIL' END || E' E1 daily allowance used up, no conversation yet -> NULL\n';
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.conversations (participant_one_id, participant_two_id) VALUES (v_me, v_help);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  v_out := v_out || CASE WHEN public.hockia_help_profile_id() = v_help THEN 'PASS' ELSE 'FAIL' END || E' E2 allowance used up but the conversation exists -> the help account\n';

  v_out := v_out || CASE WHEN NOT has_function_privilege('anon', 'public.hockia_help_profile_id()', 'EXECUTE')
                          AND has_function_privilege('authenticated', 'public.hockia_help_profile_id()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END || E' F1 anon cannot execute, authenticated can\n';

  RAISE EXCEPTION E'PROBE RESULTS\n%', v_out;
END
$probe$;
