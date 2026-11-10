-- READ-ONLY probe for 20261109220000_admin_member_blocks.sql.
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.admin_get_member_blocks(integer,integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS status, 'anon cannot list member blocks' AS chk
UNION ALL SELECT CASE WHEN position('is_platform_admin' in pg_get_functiondef('public.admin_get_member_blocks(integer,integer)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'member blocks is admin-gated'
UNION ALL SELECT CASE WHEN position('blocker_id' in pg_get_functiondef('public.admin_get_member_blocks(integer,integer)'::regprocedure)) = 0 THEN 'PASS' ELSE 'FAIL' END, 'never returns who blocked (no blocker_id in the body)';
