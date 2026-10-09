-- READ-ONLY probe for 20261009100000_b2_club_reminders.sql: the new functions'
-- security mode, search_path and grants; the log tables' RLS, grants and
-- unique constraints; the enum values, switches and cron jobs. No writes, no
-- identity switches: safe for the MCP execute_sql tool and for prod.
-- Behaviour (fences, idempotency, notifications) needs fixtures: see
-- b2_club_reminders.probe.sql (staging, rolled back).
--
-- Expected, from the migration:
--   function                                                    definer anon auth service_role
--   club_reminder_candidates(text, timestamptz)                 yes     no   no   yes
--   club_reminder_claim(uuid, text, text, date, jsonb, jsonb)   yes     no   no   yes
--   club_reminder_finish(uuid, boolean)                         yes     no   no   yes
--   club_reminder_skip(uuid, date, uuid[])                      yes     no   no   yes
--   run_club_reminders(text)                                    yes     no   no   yes
-- PUBLIC holds nothing on any of them; all have search_path=public.
-- Tables club_reminder_batches / club_reminder_log: RLS on, anon and
-- authenticated hold no privilege, service_role holds SELECT/INSERT/UPDATE/DELETE.
--
-- Returns one row per check: status (PASS / FAIL), check, detail. Every row must be PASS.

WITH fns(sig) AS (
  VALUES ('public.club_reminder_candidates(text, timestamp with time zone)'),
         ('public.club_reminder_claim(uuid, text, text, date, jsonb, jsonb)'),
         ('public.club_reminder_finish(uuid, boolean)'),
         ('public.club_reminder_skip(uuid, date, uuid[])'),
         ('public.run_club_reminders(text)')
),
shape AS (
  SELECT f.sig, p.oid, p.prosecdef, p.proacl, coalesce(array_to_string(p.proconfig, ','), '') AS cfg
    FROM fns f
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
),
tbls(name) AS (VALUES ('public.club_reminder_batches'), ('public.club_reminder_log')),
checks(status, name, detail) AS (
  SELECT CASE WHEN s.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'E1 exists: ' || s.sig, coalesce(s.oid::text, 'missing')
    FROM shape s
  UNION ALL
  SELECT CASE WHEN s.prosecdef AND s.cfg ILIKE '%search_path=public%' THEN 'PASS' ELSE 'FAIL' END,
         'F1 definer + search_path: ' || s.sig, coalesce(s.prosecdef::text, 'NULL') || ' ' || s.cfg
    FROM shape s WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT CASE WHEN NOT has_function_privilege('anon', s.oid, 'EXECUTE')
               AND NOT has_function_privilege('authenticated', s.oid, 'EXECUTE')
               AND has_function_privilege('service_role', s.oid, 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END,
         'X1 service_role only: ' || s.sig,
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
  SELECT CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END, 'T1 RLS on: ' || t.name, coalesce(c.relrowsecurity::text, 'missing')
    FROM tbls t LEFT JOIN pg_class c ON c.oid = to_regclass(t.name)
  UNION ALL
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND 'public.' || p.tablename = t.name)
              THEN 'PASS' ELSE 'FAIL' END,
         'T2 no client policy: ' || t.name, ''
    FROM tbls t
  UNION ALL
  SELECT CASE WHEN NOT has_table_privilege('anon', t.name, 'SELECT,INSERT,UPDATE,DELETE')
               AND NOT has_table_privilege('authenticated', t.name, 'SELECT,INSERT,UPDATE,DELETE')
               AND has_table_privilege('service_role', t.name, 'SELECT')
               AND has_table_privilege('service_role', t.name, 'INSERT')
              THEN 'PASS' ELSE 'FAIL' END,
         'T3 grants service_role only: ' || t.name,
         format('anon=%s authenticated=%s service_role=%s',
                has_table_privilege('anon', t.name, 'SELECT,INSERT,UPDATE,DELETE'),
                has_table_privilege('authenticated', t.name, 'SELECT,INSERT,UPDATE,DELETE'),
                has_table_privilege('service_role', t.name, 'SELECT'))
    FROM tbls t WHERE to_regclass(t.name) IS NOT NULL
  UNION ALL
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint k
            WHERE k.conrelid = 'public.club_reminder_log'::regclass AND k.contype = 'u'
              AND pg_get_constraintdef(k.oid) = 'UNIQUE (application_id, kind, channel)')
         THEN 'PASS' ELSE 'FAIL' END,
         'U1 one log row per (application, kind, channel)', ''
  UNION ALL
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM pg_indexes i
            WHERE i.schemaname = 'public' AND i.indexname = 'ux_club_reminder_batches_daily'
              AND i.indexdef ILIKE '%UNIQUE%(publisher_id, channel, local_date)%batch_kind = ''reminder''%')
         THEN 'PASS' ELSE 'FAIL' END,
         'U2 one reminder email / push per publisher per local day', ''
  UNION ALL
  SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
         'K1 notification kinds added', string_agg(e.enumlabel, ',')
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'profile_notification_kind' AND e.enumlabel IN ('applicants_closing_soon', 'applicant_last_call')
  UNION ALL
  SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
         'S1 switches exist', string_agg(column_name || '=' || coalesce(column_default, 'NULL'), ', ')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'application_response_settings'
     AND column_name IN ('club_reminders_enabled', 'batched_application_emails_since')
  UNION ALL
  -- Informational on first deploy: both switches start off.
  SELECT 'PASS', 'S2 switch state (informational)',
         format('club_reminders_enabled=%s batched_application_emails_since=%s sweep_enabled=%s launch_date=%s',
                s.club_reminders_enabled, coalesce(s.batched_application_emails_since::text, 'NULL'), s.sweep_enabled, coalesce(s.launch_date::text, 'NULL'))
    FROM public.application_response_settings s
  UNION ALL
  SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
         'C1 cron jobs scheduled', string_agg(jobname || ' ' || schedule, ', ')
    FROM cron.job WHERE jobname IN ('club_reminders_hourly', 'club_new_applications')
  UNION ALL
  SELECT CASE WHEN pg_get_functiondef(to_regprocedure('public.club_reminder_candidates(text, timestamp with time zone)')) ILIKE '%profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)%'
               AND pg_get_functiondef(to_regprocedure('public.club_reminder_candidates(text, timestamp with time zone)')) ILIKE '%profile_is_adult(ap.date_of_birth)%'
               AND pg_get_functiondef(to_regprocedure('public.club_reminder_candidates(text, timestamp with time zone)')) ILIKE '%is_blocked_pair(%'
               AND pg_get_functiondef(to_regprocedure('public.club_reminder_candidates(text, timestamp with time zone)')) ILIKE '%is_test_account%'
              THEN 'PASS' ELSE 'FAIL' END,
         'B1 candidates carry the hidden / minor / blocked / test fences', ''
)
SELECT status, name AS check, detail FROM checks ORDER BY name;
