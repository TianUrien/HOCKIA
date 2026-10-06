-- READ-ONLY probe for 20261006100000_audit_db_hardening.sql: function grants and
-- security mode, body markers, the three new triggers, profiles column privileges,
-- the work-permit policy, link_signup_attribution signatures and the cron jobs.
-- No writes, no identity switches: safe for the MCP execute_sql tool and for prod.
-- Behaviour checks need fixtures: see audit_db_hardening.probe.sql (staging, rolled back).
--
-- Run it BEFORE the migration too and keep the output: the FAIL rows then are the
-- previous state, which the rollback restores.
--
-- Expected function grants (PUBLIC must hold nothing on any of them):
--   function                                                     definer anon auth service
--   _enqueue_user_post_media(uuid, jsonb, text)                  yes     no   no   yes
--   record_milestone(uuid, text, boolean, jsonb)                 yes     no   no   yes
--   check_rate_limit(text, text, integer, integer)               yes     no   no   yes
--   cleanup_rate_limits(integer)                                 yes     no   no   yes
--   prune_old_heartbeats(integer)                                yes     no   no   yes
--   prune_old_logs()                                             yes     no   no   yes
--   compute_product_health_score()                               yes     no   no   yes
--   _guard_world_club_client_update()                            yes     no   no   yes
--   _guard_client_message_sender()                               yes     no   no   yes
--   _guard_client_conversation_start()                           yes     no   no   yes
--   club_has_applicant(uuid, uuid)                               yes     no   yes  yes
--   user_in_conversation(uuid, uuid)                             yes     no   yes  yes
--   is_blocked_pair(uuid, uuid)                                  yes     no   yes  yes
--   is_suggestible(uuid)                                         yes     no   yes  yes
--   can_toggle_open_to_play(uuid)                                yes     no   yes  yes
--   check_application_rate_limit(uuid)                           yes     no   yes  yes
--   check_message_rate_limit(uuid)                               yes     no   yes  yes
--   check_user_post_rate_limit(uuid)                             yes     no   yes  yes
--   is_adult_profile(uuid)                                       yes     no   yes  yes
--   claim_world_club(uuid, uuid, integer, integer)               yes     no   yes  yes
--   create_and_claim_world_club(text, int, int, uuid, int, int)  yes     no   yes  yes
--   admin_send_removed_account_notice(uuid)                      yes     no   yes  yes
--   admin_unblock_user(uuid)                                     yes     no   yes  yes
--   link_signup_attribution(text, text, text, jsonb, text, tstz) yes     no   yes  yes
--   check_login_rate_limit(text)                                 no      yes  yes  yes   (stub for installed apps)
--   ai_opinion_quota_take(uuid, integer)                         yes     no   no   yes
--   ai_opinion_quota_release(uuid)                               yes     no   no   yes
--   ai_questions_today(uuid)                                     yes     no   no   yes
--   _push_subscription_single_owner()                            yes     no   no   yes
--
-- Returns one row per check: status (PASS / FAIL), check, detail. Every row must be PASS.

WITH expected(sig, definer, anon_x, auth_x, service_x) AS (
  VALUES ('public._enqueue_user_post_media(uuid, jsonb, text)',                             true,  false, false, true),
         ('public.record_milestone(uuid, text, boolean, jsonb)',                            true,  false, false, true),
         ('public.check_rate_limit(text, text, integer, integer)',                          true,  false, false, true),
         ('public.cleanup_rate_limits(integer)',                                            true,  false, false, true),
         ('public.prune_old_heartbeats(integer)',                                           true,  false, false, true),
         ('public.prune_old_logs()',                                                        true,  false, false, true),
         ('public.compute_product_health_score()',                                          true,  false, false, true),
         ('public._guard_world_club_client_update()',                                       true,  false, false, true),
         ('public._guard_client_message_sender()',                                          true,  false, false, true),
         ('public._guard_client_conversation_start()',                                      true,  false, false, true),
         ('public.club_has_applicant(uuid, uuid)',                                          true,  false, true,  true),
         ('public.user_in_conversation(uuid, uuid)',                                        true,  false, true,  true),
         ('public.is_blocked_pair(uuid, uuid)',                                             true,  false, true,  true),
         ('public.is_suggestible(uuid)',                                                    true,  false, true,  true),
         ('public.can_toggle_open_to_play(uuid)',                                           true,  false, true,  true),
         ('public.check_application_rate_limit(uuid)',                                      true,  false, true,  true),
         ('public.check_message_rate_limit(uuid)',                                          true,  false, true,  true),
         ('public.check_user_post_rate_limit(uuid)',                                        true,  false, true,  true),
         ('public.is_adult_profile(uuid)',                                                  true,  false, true,  true),
         ('public.claim_world_club(uuid, uuid, integer, integer)',                          true,  false, true,  true),
         ('public.create_and_claim_world_club(text, integer, integer, uuid, integer, integer)', true, false, true, true),
         ('public.admin_send_removed_account_notice(uuid)',                                 true,  false, true,  true),
         ('public.admin_unblock_user(uuid)',                                                true,  false, true,  true),
         ('public.link_signup_attribution(text, text, text, jsonb, text, timestamp with time zone)', true, false, true, true),
         ('public.check_login_rate_limit(text)',                                            false, true,  true,  true),
         ('public.ai_opinion_quota_take(uuid, integer)',                                    true,  false, false, true),
         ('public.ai_opinion_quota_release(uuid)',                                          true,  false, false, true),
         ('public.ai_questions_today(uuid)',                                                true,  false, false, true),
         ('public._push_subscription_single_owner()',                                       true,  false, false, true)
),
shape AS (
  SELECT e.*, p.oid, p.prosecdef, p.proacl,
         coalesce(array_to_string(p.proconfig, ','), '') AS cfg
    FROM expected e
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
),
markers(sig, marker, present) AS (
  VALUES ('public.claim_world_club(uuid, uuid, integer, integer)', 'already linked to a club', true),
         ('public.claim_world_club(uuid, uuid, integer, integer)', 'world_club_claim:', true),
         ('public.create_and_claim_world_club(text, integer, integer, uuid, integer, integer)', 'already linked to a club', true),
         ('public.admin_send_removed_account_notice(uuid)', 'Block the account first.', true),
         ('public.admin_send_removed_account_notice(uuid)', 'is_platform_admin', true),
         ('public.admin_unblock_user(uuid)', 'DELETE FROM removed_account_notices', true),
         ('public.check_application_rate_limit(uuid)', 'auth.uid()', true),
         ('public.check_message_rate_limit(uuid)', 'auth.uid()', true),
         ('public.check_user_post_rate_limit(uuid)', 'auth.uid()', true),
         ('public.check_login_rate_limit(text)', 'check_rate_limit', false),
         ('public.check_login_rate_limit(text)', '''allowed'', true', true),
         ('public._guard_client_conversation_start()', 'recruiter_minor', true),
         ('public._guard_client_conversation_start()', 'This member can''t be contacted by clubs or coaches.', true),
         ('public._guard_client_conversation_start()', 'is_recruiter', true),
         ('public._guard_client_conversation_start()', 'is_minor', true),
         ('public._guard_client_message_sender()', 'profile_is_hidden', true),
         ('public._guard_world_club_client_update()', 'is_platform_admin', true),
         ('public._guard_world_club_client_update()', 'verified_at', true),
         ('public.link_signup_attribution(text, text, text, jsonb, text, timestamp with time zone)', '(?:[^@/]+@)?', true),
         ('public.ai_questions_today(uuid)', 'l.function = ''nl-search''', true),
         ('public.ai_questions_today(uuid)', '<> ''alert''', false),
         ('public.ai_opinion_quota_take(uuid, integer)', 'WHERE q.count < p_limit', true),
         ('public.ai_opinion_quota_release(uuid)', 'count > 0', true),
         ('public._push_subscription_single_owner()', 'IS DISTINCT FROM NEW.profile_id', true)
),
triggers(tbl, trg, fn) AS (
  VALUES ('public.world_clubs',   'world_clubs_guard_client_update', '_guard_world_club_client_update'),
         ('public.messages',      'messages_client_sender_guard',    '_guard_client_message_sender'),
         ('public.conversations', 'conversations_client_start_guard', '_guard_client_conversation_start')
),
trigger_shape AS (
  SELECT x.tbl, x.trg, x.fn, t.oid, t.tgenabled,
         CASE WHEN t.oid IS NOT NULL THEN pg_get_triggerdef(t.oid) END AS def,
         (SELECT p.proname FROM pg_proc p WHERE p.oid = t.tgfoid) AS actual_fn
    FROM triggers x
    LEFT JOIN pg_trigger t ON t.tgrelid = to_regclass(x.tbl) AND t.tgname = x.trg AND NOT t.tgisinternal
),
cols(col, priv, want) AS (
  VALUES ('email',      'UPDATE', false),
         ('created_at', 'UPDATE', false),
         ('full_name',  'UPDATE', true),
         ('bio',        'UPDATE', true),
         ('email',      'INSERT', true),   -- first-login placeholder insert sends it
         ('email',      'SELECT', true),   -- read revoke deferred (old store builds select *)
         ('date_of_birth', 'SELECT', true) -- untouched (temporary regrant 20260707230000)
),
jobs(jobname, want_present, want_command) AS (
  VALUES ('archive_messages_daily',     false, NULL),
         ('cleanup_rate_limits_daily',  true,  'public.cleanup_rate_limits(24)'),
         ('prune_old_heartbeats_daily', true,  'public.prune_old_heartbeats(90)'),
         ('prune_old_logs',             NULL::boolean, NULL)  -- informational: an existing job, untouched
),
checks(status, name, detail) AS (
  -- Functions: exist, security mode, search_path
  SELECT CASE WHEN s.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'E1 exists: ' || s.sig, coalesce(s.oid::text, 'missing')
    FROM shape s
  UNION ALL
  SELECT CASE WHEN s.prosecdef = s.definer AND s.cfg ILIKE '%search_path=public%' THEN 'PASS' ELSE 'FAIL' END,
         'F1 security mode + search_path: ' || s.sig, coalesce(s.prosecdef::text, 'NULL') || ' ' || s.cfg
    FROM shape s WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT CASE WHEN has_function_privilege('anon', s.oid, 'EXECUTE') = s.anon_x
               AND has_function_privilege('authenticated', s.oid, 'EXECUTE') = s.auth_x
               AND has_function_privilege('service_role', s.oid, 'EXECUTE') = s.service_x
              THEN 'PASS' ELSE 'FAIL' END,
         'X1 grants as recorded: ' || s.sig,
         format('anon=%s authenticated=%s service_role=%s acl=%s',
                has_function_privilege('anon', s.oid, 'EXECUTE'),
                has_function_privilege('authenticated', s.oid, 'EXECUTE'),
                has_function_privilege('service_role', s.oid, 'EXECUTE'),
                coalesce(s.proacl::text, 'NULL'))
    FROM shape s WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT CASE WHEN s.proacl IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM aclexplode(s.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END,
         'X2 nothing for PUBLIC: ' || s.sig, coalesce(s.proacl::text, 'NULL')
    FROM shape s WHERE s.oid IS NOT NULL
  UNION ALL
  -- Body markers
  SELECT CASE WHEN to_regprocedure(m.sig) IS NOT NULL
               AND (strpos(pg_get_functiondef(to_regprocedure(m.sig)), m.marker) > 0) = m.present
              THEN 'PASS' ELSE 'FAIL' END,
         'B1 body ' || CASE WHEN m.present THEN 'has' ELSE 'lacks' END || ': ' || m.sig || ' · ' || m.marker, ''
    FROM markers m
  UNION ALL
  -- link_signup_attribution: exactly one signature (the 6-argument one)
  SELECT CASE WHEN count(*) = 1 AND bool_and(pg_get_function_identity_arguments(p.oid) ILIKE '%p_first_source%') THEN 'PASS' ELSE 'FAIL' END,
         'L1 link_signup_attribution has one signature, with p_first_source',
         string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'link_signup_attribution'
  UNION ALL
  -- New triggers: present, enabled, BEFORE, per row, right function, client statements only
  SELECT CASE WHEN t.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'R1 trigger exists: ' || t.trg, coalesce(t.def, 'missing')
    FROM trigger_shape t
  UNION ALL
  SELECT CASE WHEN t.tgenabled = 'O' AND t.actual_fn = t.fn AND t.def ILIKE '%BEFORE%' AND t.def ILIKE '%FOR EACH ROW%'
              THEN 'PASS' ELSE 'FAIL' END,
         'R2 enabled, BEFORE, per row, right function: ' || t.trg,
         coalesce(t.tgenabled::text, 'NULL') || ' ' || coalesce(t.actual_fn, 'NULL')
    FROM trigger_shape t
  UNION ALL
  SELECT CASE WHEN t.def ILIKE '%WHEN%CURRENT_USER%authenticated%' THEN 'PASS' ELSE 'FAIL' END,
         'R3 fires for client statements only: ' || t.trg, coalesce(t.def, 'missing')
    FROM trigger_shape t
  UNION ALL
  -- Push device owner trigger: BEFORE INSERT OR UPDATE OF endpoint, fcm_token, profile_id
  SELECT CASE WHEN count(*) = 1 AND bool_and(t.tgenabled = 'O')
               AND bool_and(pg_get_triggerdef(t.oid) ILIKE '%BEFORE INSERT OR UPDATE OF endpoint, fcm_token, profile_id%FOR EACH ROW%_push_subscription_single_owner%')
              THEN 'PASS' ELSE 'FAIL' END,
         'R4 push_subscriptions_single_owner trigger', coalesce(string_agg(pg_get_triggerdef(t.oid), ' | '), 'missing')
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.push_subscriptions'::regclass AND t.tgname = 'push_subscriptions_single_owner' AND NOT t.tgisinternal
  UNION ALL
  -- send-push: the INSERT webhook still there, plus the UPDATE clone for re-surfaced rows
  SELECT CASE WHEN count(*) FILTER (WHERE pg_get_triggerdef(t.oid) ILIKE '%AFTER INSERT ON public.profile_notifications%') = 1
               AND count(*) FILTER (WHERE t.tgname = 'send-push-resurfaced'
                                      AND pg_get_triggerdef(t.oid) ILIKE '%AFTER UPDATE ON public.profile_notifications FOR EACH ROW WHEN ((old.created_at IS DISTINCT FROM new.created_at))%'
                                      AND t.tgenabled = 'O') = 1
               AND count(*) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         'R5 send-push webhook: one AFTER INSERT + one AFTER UPDATE WHEN created_at changed',
         count(*)::text || ' trigger(s): ' || coalesce(string_agg(t.tgname, ', '), '')
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.profile_notifications'::regclass AND NOT t.tgisinternal
     AND pg_get_triggerdef(t.oid) LIKE '%/functions/v1/send-push%'
  UNION ALL
  -- The existing contact triggers are untouched
  SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END, 'K1 existing block triggers still on messages + conversations', count(*)::text
    FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgrelid = 'public.messages'::regclass AND t.tgname = 'messages_enforce_not_blocked')
       OR (t.tgrelid = 'public.conversations'::regclass AND t.tgname = 'conversations_enforce_not_blocked'))
  UNION ALL
  -- profiles column privileges for authenticated
  SELECT CASE WHEN has_column_privilege('authenticated', 'public.profiles', c.col, c.priv) = c.want THEN 'PASS' ELSE 'FAIL' END,
         format('C1 authenticated %s on profiles.%s = %s', c.priv, c.col, c.want),
         has_column_privilege('authenticated', 'public.profiles', c.col, c.priv)::text
    FROM cols c
  UNION ALL
  SELECT CASE WHEN NOT has_column_privilege('anon', 'public.profiles', 'email', 'UPDATE')
               AND NOT has_column_privilege('anon', 'public.profiles', 'created_at', 'UPDATE')
              THEN 'PASS' ELSE 'FAIL' END,
         'C2 anon cannot update profiles.email / created_at', ''
  UNION ALL
  -- Work-permit policy: recruiters, visible players, known adults
  SELECT CASE WHEN p.qual ILIKE '%is_adult_profile%' AND p.qual ILIKE '%is_recruiter%' AND p.qual ILIKE '%profile_is_hidden%'
              THEN 'PASS' ELSE 'FAIL' END,
         'P1 player_work_permits_recruiter_select has the adult fence', coalesce(p.qual, 'missing')
    FROM (SELECT 1) one
    LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = 'player_work_permits'
                           AND p.policyname = 'player_work_permits_recruiter_select'
  UNION ALL
  -- Cron jobs
  SELECT CASE WHEN j.want_present IS NULL THEN 'PASS'
              WHEN j.want_present = (c.jobid IS NOT NULL)
               AND (j.want_command IS NULL OR c.command ILIKE '%' || j.want_command || '%')
               AND (c.jobid IS NULL OR c.active)
              THEN 'PASS' ELSE 'FAIL' END,
         'J1 cron ' || j.jobname || CASE WHEN j.want_present IS NULL THEN ' (info)'
                                         WHEN j.want_present THEN ' scheduled' ELSE ' not scheduled' END,
         coalesce(c.schedule || ' · ' || c.command, 'absent')
    FROM jobs j
    LEFT JOIN cron.job c ON c.jobname = j.jobname
)
SELECT status, name AS check, detail FROM checks ORDER BY name;
