-- READ-ONLY probe for 20261011150300_home_v1_feed_v2.sql.
SELECT CASE WHEN to_regprocedure('public.get_home_feed_v2(integer, integer)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status, 'v2 exists' AS chk
UNION ALL SELECT CASE WHEN (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.get_home_feed_v2(integer, integer)')) THEN 'PASS' ELSE 'FAIL' END, 'v2 security definer'
UNION ALL SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure('public.get_home_feed_v2(integer, integer)'))) a WHERE a.grantee = 0) THEN 'PASS' ELSE 'FAIL' END, 'v2: PUBLIC holds nothing'
UNION ALL SELECT CASE WHEN position('members_digest' in pg_get_functiondef('public.get_home_feed(integer, integer, text, integer[], text[])'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'old feed excludes digest'
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_members_digest') THEN 'PASS' ELSE 'FAIL' END, 'digest trigger';
