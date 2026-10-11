-- READ-ONLY probe for 20261011110000_get_member_photos.sql. Safe for MCP and prod.
-- Expected: SECURITY INVOKER (RLS applies), search_path=public, EXECUTE for
-- anon / authenticated / service_role, nothing for PUBLIC.
WITH f AS (SELECT p.oid, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_member_photos(uuid[], integer)'))
SELECT CASE WHEN EXISTS (SELECT 1 FROM f) THEN 'PASS' ELSE 'FAIL' END AS status, 'function exists' AS chk
UNION ALL SELECT CASE WHEN NOT (SELECT prosecdef FROM f) THEN 'PASS' ELSE 'FAIL' END, 'security invoker'
UNION ALL SELECT CASE WHEN (SELECT 'search_path=public' = ANY (proconfig) FROM f) THEN 'PASS' ELSE 'FAIL' END, 'search_path pinned'
UNION ALL SELECT CASE WHEN has_function_privilege('anon', 'public.get_member_photos(uuid[], integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon can execute'
UNION ALL SELECT CASE WHEN has_function_privilege('authenticated', 'public.get_member_photos(uuid[], integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'authenticated can execute'
UNION ALL SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM f, aclexplode((SELECT proacl FROM pg_proc WHERE oid = f.oid)) a WHERE a.grantee = 0) THEN 'PASS' ELSE 'FAIL' END, 'PUBLIC holds nothing';
