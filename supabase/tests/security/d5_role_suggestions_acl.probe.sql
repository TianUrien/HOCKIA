-- READ-ONLY probe for 20261004100000_d5_role_suggestions.sql: grants, RLS,
-- function shape, triggers and the cron job. No writes, no identity switches:
-- safe for the MCP execute_sql tool (which declines write probes) and for prod.
-- The behaviour checks (fences, refresh limit, trigger effects) need fixtures:
-- see d5_role_suggestions.probe.sql (staging, rolled back).
--
-- Returns one row per check: status (PASS / FAIL), check, detail. Every row must be PASS.

WITH fns(sig) AS (
  VALUES ('public.compute_role_suggestions(uuid)'),
         ('public.refresh_role_suggestions(uuid)'),
         ('public.get_role_suggestions(uuid)'),
         ('public.run_role_suggestions_nightly()'),
         ('public._role_suggestions_on_change()')
),
fn_shape AS (
  SELECT f.sig,
         p.prosecdef,
         coalesce(array_to_string(p.proconfig, ','), '') AS cfg
    FROM fns f
    JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
),
checks(status, name, detail) AS (
  -- Tables exist with RLS on
  SELECT CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END, 'T1 RLS on role_suggestions', c.relrowsecurity::text
    FROM pg_class c WHERE c.oid = 'public.role_suggestions'::regclass
  UNION ALL
  SELECT CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END, 'T2 RLS on role_suggestion_runs', c.relrowsecurity::text
    FROM pg_class c WHERE c.oid = 'public.role_suggestion_runs'::regclass
  -- Table grants
  UNION ALL
  SELECT CASE WHEN has_table_privilege('authenticated', 'public.role_suggestions', 'SELECT')
               AND NOT has_table_privilege('authenticated', 'public.role_suggestions', 'INSERT')
               AND NOT has_table_privilege('authenticated', 'public.role_suggestions', 'UPDATE')
               AND NOT has_table_privilege('authenticated', 'public.role_suggestions', 'DELETE')
              THEN 'PASS' ELSE 'FAIL' END,
         'G1 authenticated: SELECT only on role_suggestions', ''
  UNION ALL
  SELECT CASE WHEN NOT has_table_privilege('anon', 'public.role_suggestions', 'SELECT') THEN 'PASS' ELSE 'FAIL' END,
         'G2 anon: nothing on role_suggestions', ''
  UNION ALL
  SELECT CASE WHEN NOT has_table_privilege('authenticated', 'public.role_suggestion_runs', 'SELECT')
               AND NOT has_table_privilege('anon', 'public.role_suggestion_runs', 'SELECT')
              THEN 'PASS' ELSE 'FAIL' END,
         'G3 role_suggestion_runs is service-role only', ''
  -- Policies: exactly one, SELECT, for authenticated, checks the publisher
  UNION ALL
  SELECT CASE WHEN count(*) = 1 AND bool_and(pol.cmd = 'SELECT') AND bool_and(pol.qual ILIKE '%club_id%auth.uid()%') THEN 'PASS' ELSE 'FAIL' END,
         'P1 one SELECT policy, publisher-only', string_agg(pol.policyname || ':' || pol.cmd, ',')
    FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.tablename = 'role_suggestions'
  UNION ALL
  SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, 'P2 no policies on role_suggestion_runs', count(*)::text
    FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.tablename = 'role_suggestion_runs'
  -- Functions: SECURITY DEFINER + search_path
  UNION ALL
  SELECT CASE WHEN s.prosecdef AND s.cfg ILIKE '%search_path=public%' THEN 'PASS' ELSE 'FAIL' END,
         'F1 definer + search_path: ' || s.sig, s.prosecdef::text || ' ' || s.cfg
    FROM fn_shape s
  UNION ALL
  SELECT CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END, 'F2 all five D5 functions exist', count(*)::text FROM fn_shape
  -- Function grants
  UNION ALL
  SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.compute_role_suggestions(uuid)', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.compute_role_suggestions(uuid)', 'EXECUTE')
               AND has_function_privilege('service_role', 'public.compute_role_suggestions(uuid)', 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END, 'X1 compute_role_suggestions: service_role only', ''
  UNION ALL
  SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.run_role_suggestions_nightly()', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.run_role_suggestions_nightly()', 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END, 'X2 run_role_suggestions_nightly: service_role only', ''
  UNION ALL
  SELECT CASE WHEN has_function_privilege('authenticated', 'public.get_role_suggestions(uuid)', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.get_role_suggestions(uuid)', 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END, 'X3 get_role_suggestions: authenticated, not anon', ''
  UNION ALL
  SELECT CASE WHEN has_function_privilege('authenticated', 'public.refresh_role_suggestions(uuid)', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.refresh_role_suggestions(uuid)', 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END, 'X4 refresh_role_suggestions: authenticated, not anon', ''
  UNION ALL
  SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public._role_suggestions_on_change()', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public._role_suggestions_on_change()', 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END, 'X5 trigger function not client-callable', ''
  -- compute_club_fit untouched: still INVOKER with its recruiters-only guard
  UNION ALL
  SELECT CASE WHEN NOT p.prosecdef AND pg_get_functiondef(p.oid) ILIKE '%auth.uid() IS DISTINCT FROM p_owner_id%' THEN 'PASS' ELSE 'FAIL' END,
         'X6 compute_club_fit unchanged (INVOKER + owner guard)', p.prosecdef::text
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.compute_club_fit(uuid, uuid, text, text, uuid)')
  -- Triggers
  UNION ALL
  SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END, 'R1 both opportunities triggers present', string_agg(t.tgname, ',')
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.opportunities'::regclass
     AND t.tgname IN ('role_suggestions_on_insert', 'role_suggestions_on_update')
     AND NOT t.tgisinternal
  -- Cron
  UNION ALL
  SELECT CASE WHEN count(*) = 1 AND bool_and(j.schedule = '30 3 * * *') AND bool_and(j.command ILIKE '%run_role_suggestions_nightly%') THEN 'PASS' ELSE 'FAIL' END,
         'C1 cron role_suggestions_nightly at 03:30 UTC', string_agg(j.schedule || ' ' || j.command, ' | ')
    FROM cron.job j WHERE j.jobname = 'role_suggestions_nightly'
  -- Shape: the stored evidence never carries private keys (live rows, read-only)
  UNION ALL
  SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, 'S1 no stored evidence has dob/email/phone keys', count(*)::text
    FROM public.role_suggestions s
   WHERE s.evidence ?| ARRAY['date_of_birth', 'dob', 'email', 'phone', 'contact_email', 'contact_phone', 'age']
  UNION ALL
  SELECT CASE WHEN coalesce(max(n), 0) <= 5 THEN 'PASS' ELSE 'FAIL' END, 'S2 at most 5 suggestions per role', coalesce(max(n), 0)::text
    FROM (SELECT count(*) AS n FROM public.role_suggestions GROUP BY opportunity_id) x
)
SELECT status, name AS check, detail FROM checks ORDER BY name;
