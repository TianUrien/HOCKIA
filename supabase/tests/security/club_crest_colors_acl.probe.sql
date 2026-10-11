-- READ-ONLY probe for 20261011120000_club_crest_colors.sql. Safe for MCP and prod.
-- Expected: RLS on; anon reads only; authenticated reads + writes (own row via
-- RLS); no DELETE for clients; PUBLIC holds nothing.
SELECT CASE WHEN to_regclass('public.club_crest_colors') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status, 'table exists' AS chk
UNION ALL SELECT CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.club_crest_colors'::regclass) THEN 'PASS' ELSE 'FAIL' END, 'RLS enabled'
UNION ALL SELECT CASE WHEN has_table_privilege('anon', 'public.club_crest_colors', 'SELECT') THEN 'PASS' ELSE 'FAIL' END, 'anon can read'
UNION ALL SELECT CASE WHEN NOT has_table_privilege('anon', 'public.club_crest_colors', 'INSERT') AND NOT has_table_privilege('anon', 'public.club_crest_colors', 'UPDATE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot write'
UNION ALL SELECT CASE WHEN has_table_privilege('authenticated', 'public.club_crest_colors', 'INSERT') THEN 'PASS' ELSE 'FAIL' END, 'authenticated can insert (own row by RLS)'
UNION ALL SELECT CASE WHEN NOT has_table_privilege('authenticated', 'public.club_crest_colors', 'DELETE') THEN 'PASS' ELSE 'FAIL' END, 'authenticated cannot delete'
UNION ALL SELECT CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'club_crest_colors') = 3 THEN 'PASS' ELSE 'FAIL' END, 'three policies'
UNION ALL SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = 'public.club_crest_colors'::regclass)) a WHERE a.grantee = 0) THEN 'PASS' ELSE 'FAIL' END, 'PUBLIC holds nothing';
