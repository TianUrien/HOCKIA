-- READ-ONLY probe for 20261011150600 + 20261011150700 (admin takedown v2).
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.admin_takedown_content(text,uuid,uuid,text,boolean)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS status, 'anon cannot take down' AS chk
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.admin_restore_content(uuid)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot restore'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.admin_content_preview(text,uuid)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot preview'
UNION ALL SELECT CASE WHEN position('is_platform_admin' in pg_get_functiondef('public.admin_takedown_content(text,uuid,uuid,text,boolean)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'takedown is admin-gated'
UNION ALL SELECT CASE WHEN position('is_platform_admin' in pg_get_functiondef('public.admin_restore_content(uuid)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'restore is admin-gated'
UNION ALL SELECT CASE WHEN position('is_platform_admin' in pg_get_functiondef('public.admin_content_preview(text,uuid)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'preview is admin-gated'
UNION ALL SELECT CASE WHEN to_regprocedure('public.admin_takedown_content(text,uuid,uuid,text)') IS NULL THEN 'PASS' ELSE 'FAIL' END, 'old takedown overload dropped'
UNION ALL SELECT CASE WHEN NOT has_table_privilege('authenticated', 'public.content_takedowns', 'SELECT') AND NOT has_table_privilege('anon', 'public.content_takedowns', 'SELECT') THEN 'PASS' ELSE 'FAIL' END, 'content_takedowns not readable by clients'
UNION ALL SELECT CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END, 'content_takedowns has RLS' FROM pg_class c WHERE c.oid = 'public.content_takedowns'::regclass
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'profile_notification_kind' AND e.enumlabel = 'content_removed') THEN 'PASS' ELSE 'FAIL' END, 'content_removed kind exists';
