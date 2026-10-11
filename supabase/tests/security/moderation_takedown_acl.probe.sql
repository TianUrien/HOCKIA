-- READ-ONLY probe for 20261011150000_moderation_takedown_comment_controls.sql.
-- Expected: takedown + comments switch are authenticated-only (admin check is
-- inside), PUBLIC/anon hold nothing; report targets widened; column present.
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.admin_takedown_content(text, uuid, uuid, text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS status, 'takedown: anon cannot execute' AS chk
UNION ALL SELECT CASE WHEN (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.admin_takedown_content(text, uuid, uuid, text)')) THEN 'PASS' ELSE 'FAIL' END, 'takedown: security definer'
UNION ALL SELECT CASE WHEN position('is_platform_admin' in pg_get_functiondef(to_regprocedure('public.admin_takedown_content(text, uuid, uuid, text)'))) > 0 THEN 'PASS' ELSE 'FAIL' END, 'takedown: admin check present'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.set_post_comments_enabled(uuid, boolean)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'comments switch: anon cannot execute'
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_posts' AND column_name='comments_enabled') THEN 'PASS' ELSE 'FAIL' END, 'user_posts.comments_enabled exists'
UNION ALL SELECT CASE WHEN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='user_reports_content_type_check')) LIKE '%feed_item%' THEN 'PASS' ELSE 'FAIL' END, 'reports accept feed_item';
