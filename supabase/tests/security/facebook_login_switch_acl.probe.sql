-- READ-ONLY probe for 20261010100000_facebook_login_switch.sql. No writes, no
-- identity switches: safe for the MCP execute_sql tool and for prod.
--
-- Expected: public.facebook_login_enabled() is SECURITY DEFINER,
-- search_path=public, EXECUTE for anon / authenticated / service_role, nothing
-- for PUBLIC; it returns false while app_settings has no
-- 'facebook_login_enabled' = 'true' row.
--
-- Returns one row per check: status (PASS / FAIL), check, detail.

WITH f AS (
  SELECT p.oid, p.prosecdef, p.proconfig
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.facebook_login_enabled()')
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM f) THEN 'PASS' ELSE 'FAIL' END, 'function exists', ''
UNION ALL
SELECT CASE WHEN (SELECT prosecdef FROM f) THEN 'PASS' ELSE 'FAIL' END, 'security definer', ''
UNION ALL
SELECT CASE WHEN (SELECT 'search_path=public' = ANY (proconfig) FROM f) THEN 'PASS' ELSE 'FAIL' END, 'search_path pinned', (SELECT array_to_string(proconfig, ',') FROM f)
UNION ALL
SELECT CASE WHEN has_function_privilege('anon', 'public.facebook_login_enabled()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon can execute', ''
UNION ALL
SELECT CASE WHEN has_function_privilege('authenticated', 'public.facebook_login_enabled()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'authenticated can execute', ''
UNION ALL
SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM f, aclexplode((SELECT proacl FROM pg_proc WHERE oid = f.oid)) a WHERE a.grantee = 0
       ) THEN 'PASS' ELSE 'FAIL' END, 'PUBLIC holds nothing', ''
UNION ALL
SELECT CASE WHEN public.facebook_login_enabled() = EXISTS (
         SELECT 1 FROM public.app_settings WHERE key = 'facebook_login_enabled' AND value = 'true'
       ) THEN 'PASS' ELSE 'FAIL' END, 'value follows app_settings', public.facebook_login_enabled()::text;
