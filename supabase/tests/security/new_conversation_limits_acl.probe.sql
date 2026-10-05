-- READ-ONLY probe for 20261004300000_new_conversation_limits.sql: the four tables
-- (RLS on, no client grants, no policies), the eight functions (security mode,
-- search_path, grants), the two triggers and their WHEN condition. No writes, no
-- identity switches: safe for the MCP execute_sql tool and for prod. Behaviour
-- checks need fixtures: see new_conversation_limits.probe.sql (staging, rolled back).
--
-- Expected values, recorded from the migration:
--   function                                              definer  anon  authenticated  service_role
--   _new_conversation_daily_limit(uuid)                   yes      no    no             yes
--   _enforce_new_conversation_limit()                     yes      no    no             yes
--   log_new_conversation_refusal()                        yes      no    yes            yes
--   _normalise_first_message(text)                        no       no    no             yes
--   _track_first_message()                                yes      no    no             yes
--   admin_get_spam_signals(integer, integer, integer)     yes      no    yes            yes
--   admin_send_removed_account_notice(uuid)               yes      no    yes            yes
--   is_removed_account(uuid)                              yes      no    yes            yes
-- PUBLIC must hold nothing on any of them. All have search_path=public.
--
-- Returns one row per check: status (PASS / FAIL), check, detail. Every row must be PASS.

WITH tables(name) AS (
  VALUES ('new_conversation_log'), ('spam_signals'), ('removed_account_notices'), ('removed_account_notice_recipients')
),
table_shape AS (
  SELECT t.name, c.oid, c.relrowsecurity
    FROM tables t
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.name)
),
expected(sig, definer, anon_x, auth_x, service_x) AS (
  VALUES ('public._new_conversation_daily_limit(uuid)',                 true,  false, false, true),
         ('public._enforce_new_conversation_limit()',                   true,  false, false, true),
         ('public.log_new_conversation_refusal()',                      true,  false, true,  true),
         ('public._normalise_first_message(text)',                      false, false, false, true),
         ('public._track_first_message()',                              true,  false, false, true),
         ('public.admin_get_spam_signals(integer, integer, integer)',   true,  false, true,  true),
         ('public.admin_send_removed_account_notice(uuid)',             true,  false, true,  true),
         ('public.is_removed_account(uuid)',                            true,  false, true,  true)
),
shape AS (
  SELECT e.*, p.oid, p.prosecdef, p.proacl,
         coalesce(array_to_string(p.proconfig, ','), '') AS cfg,
         pg_get_function_result(p.oid) AS result
    FROM expected e
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
),
triggers(tbl, trg, fn) AS (
  VALUES ('public.conversations', 'conversations_new_conversation_limit', '_enforce_new_conversation_limit'),
         ('public.messages',      'messages_track_first_message',         '_track_first_message')
),
trigger_shape AS (
  SELECT x.tbl, x.trg, x.fn, t.oid, t.tgenabled, t.tgtype,
         CASE WHEN t.oid IS NOT NULL THEN pg_get_triggerdef(t.oid) END AS def,
         (SELECT p.proname FROM pg_proc p WHERE p.oid = t.tgfoid) AS actual_fn
    FROM triggers x
    LEFT JOIN pg_trigger t ON t.tgrelid = to_regclass(x.tbl) AND t.tgname = x.trg AND NOT t.tgisinternal
),
checks(status, name, detail) AS (
  -- Tables
  SELECT CASE WHEN s.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'T1 table exists: ' || s.name, coalesce(s.oid::text, 'missing')
    FROM table_shape s
  UNION ALL
  SELECT CASE WHEN s.relrowsecurity THEN 'PASS' ELSE 'FAIL' END, 'T2 RLS on: ' || s.name, coalesce(s.relrowsecurity::text, 'NULL')
    FROM table_shape s
  UNION ALL
  SELECT CASE WHEN count(pol.policyname) = 0 THEN 'PASS' ELSE 'FAIL' END, 'T3 no policies: ' || s.name, count(pol.policyname)::text
    FROM table_shape s
    LEFT JOIN pg_policies pol ON pol.schemaname = 'public' AND pol.tablename = s.name
   GROUP BY s.name
  UNION ALL
  SELECT CASE WHEN NOT EXISTS (
                SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r(role_name),
                              unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr(priv)
                 WHERE has_table_privilege(r.role_name, s.oid, pr.priv))
              THEN 'PASS' ELSE 'FAIL' END,
         'G1 anon and authenticated hold nothing: ' || s.name, ''
    FROM table_shape s WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT CASE WHEN has_table_privilege('service_role', s.oid, 'SELECT') AND has_table_privilege('service_role', s.oid, 'INSERT')
              THEN 'PASS' ELSE 'FAIL' END,
         'G2 service_role can read and write: ' || s.name, ''
    FROM table_shape s WHERE s.oid IS NOT NULL
  UNION ALL
  -- PUBLIC holds nothing on the tables ("=…/owner" is PUBLIC; NULL relacl would be the default, owner only).
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = s.oid AND a.grantee = 0)
              THEN 'PASS' ELSE 'FAIL' END,
         'G3 nothing for PUBLIC: ' || s.name, ''
    FROM table_shape s WHERE s.oid IS NOT NULL
  UNION ALL
  -- Functions
  SELECT CASE WHEN s.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'E1 exists: ' || s.sig, coalesce(s.oid::text, 'missing')
    FROM shape s
  UNION ALL
  SELECT CASE WHEN s.prosecdef = s.definer AND s.cfg ILIKE '%search_path=public%' THEN 'PASS' ELSE 'FAIL' END,
         'F1 security mode + search_path: ' || s.sig, coalesce(s.prosecdef::text, 'NULL') || ' ' || s.cfg
    FROM shape s
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
  SELECT CASE WHEN s.result = r.expected THEN 'PASS' ELSE 'FAIL' END,
         'H1 return type: ' || s.sig, coalesce(s.result, 'NULL')
    FROM shape s
    JOIN (VALUES ('public._new_conversation_daily_limit(uuid)', 'integer'),
                 ('public._enforce_new_conversation_limit()', 'trigger'),
                 ('public.log_new_conversation_refusal()', 'void'),
                 ('public._track_first_message()', 'trigger'),
                 ('public.admin_get_spam_signals(integer, integer, integer)', 'jsonb'),
                 ('public.admin_send_removed_account_notice(uuid)', 'integer'),
                 ('public.is_removed_account(uuid)', 'boolean')) AS r(sig, expected) ON r.sig = s.sig
  UNION ALL
  -- The admin functions check the caller; the refusal text and its code are in the body.
  SELECT CASE WHEN pg_get_functiondef(to_regprocedure(g.sig)) ILIKE '%' || g.marker || '%' THEN 'PASS' ELSE 'FAIL' END,
         'B1 body has: ' || g.sig || ' · ' || g.marker, ''
    FROM (VALUES
      ('public.admin_get_spam_signals(integer, integer, integer)', 'is_platform_admin'),
      ('public.admin_send_removed_account_notice(uuid)', 'is_platform_admin'),
      ('public.admin_send_removed_account_notice(uuid)', 'A message about your safety'),
      ('public.admin_send_removed_account_notice(uuid)', 'removed_account_notice_recipients'),
      ('public._enforce_new_conversation_limit()', 'You can start more tomorrow.'),
      ('public._enforce_new_conversation_limit()', 'new_conversation_limit'),
      ('public._enforce_new_conversation_limit()', 'is_platform_admin'),
      ('public._new_conversation_daily_limit(uuid)', 'is_test_account'),
      ('public.is_removed_account(uuid)', 'auth.uid()')
    ) AS g(sig, marker)
  UNION ALL
  -- Triggers: present, enabled, AFTER INSERT per row, the right function, only for client statements.
  SELECT CASE WHEN t.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'R1 trigger exists: ' || t.trg, coalesce(t.def, 'missing')
    FROM trigger_shape t
  UNION ALL
  SELECT CASE WHEN t.tgenabled = 'O' AND t.actual_fn = t.fn
               AND t.def ILIKE '%AFTER INSERT ON ' || t.tbl || '%' AND t.def ILIKE '%FOR EACH ROW%'
              THEN 'PASS' ELSE 'FAIL' END,
         'R2 enabled, AFTER INSERT, per row, right function: ' || t.trg,
         coalesce(t.tgenabled::text, 'NULL') || ' ' || coalesce(t.actual_fn, 'NULL')
    FROM trigger_shape t
  UNION ALL
  SELECT CASE WHEN t.def ILIKE '%WHEN%CURRENT_USER%authenticated%' THEN 'PASS' ELSE 'FAIL' END,
         'R3 fires for client statements only (WHEN current_user = authenticated): ' || t.trg, coalesce(t.def, 'missing')
    FROM trigger_shape t
  UNION ALL
  -- The existing message limit is untouched.
  SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END, 'K1 enforce_message_rate_limit trigger still on messages', count(*)::text
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.messages'::regclass AND t.tgname = 'enforce_message_rate_limit' AND NOT t.tgisinternal AND t.tgenabled = 'O'
  UNION ALL
  SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END, 'K2 the pair index still makes one conversation per pair', count(*)::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename = 'conversations' AND i.indexname = 'conversations_participant_pair_unique'
)
SELECT status, name AS check, detail FROM checks ORDER BY name;
