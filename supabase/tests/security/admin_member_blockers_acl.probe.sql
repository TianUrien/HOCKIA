-- READ-ONLY probe for 20261123200000_admin_member_blockers.sql.
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.admin_get_member_blockers(uuid)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS status, 'anon cannot read who blocked a member' AS chk
UNION ALL SELECT CASE WHEN position('is_platform_admin' in pg_get_functiondef('public.admin_get_member_blockers(uuid)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'who blocked is admin-gated'
UNION ALL SELECT CASE WHEN position('view_member_blockers' in pg_get_functiondef('public.admin_get_member_blockers(uuid)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'every read of who blocked is written to the admin audit log'
UNION ALL SELECT CASE WHEN position('blocker_id' in pg_get_functiondef('public.admin_get_member_blocks(integer,integer)'::regprocedure)) = 0 THEN 'PASS' ELSE 'FAIL' END, 'the list still returns counts only';
