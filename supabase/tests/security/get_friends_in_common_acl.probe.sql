-- READ-ONLY probe for 20261011130000_get_friends_in_common.sql. Safe for MCP and prod.
-- Expected: SECURITY DEFINER with search_path pinned; EXECUTE for authenticated
-- and service_role only (not anon, not PUBLIC).
WITH f AS (SELECT p.oid, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_friends_in_common(uuid[])'))
SELECT CASE WHEN EXISTS (SELECT 1 FROM f) THEN 'PASS' ELSE 'FAIL' END AS status, 'function exists' AS chk
UNION ALL SELECT CASE WHEN (SELECT prosecdef FROM f) THEN 'PASS' ELSE 'FAIL' END, 'security definer'
UNION ALL SELECT CASE WHEN (SELECT 'search_path=public' = ANY (proconfig) FROM f) THEN 'PASS' ELSE 'FAIL' END, 'search_path pinned'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.get_friends_in_common(uuid[])', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot execute'
UNION ALL SELECT CASE WHEN has_function_privilege('authenticated', 'public.get_friends_in_common(uuid[])', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'authenticated can execute'
UNION ALL SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM f, aclexplode((SELECT proacl FROM pg_proc WHERE oid = f.oid)) a WHERE a.grantee = 0) THEN 'PASS' ELSE 'FAIL' END, 'PUBLIC holds nothing';
