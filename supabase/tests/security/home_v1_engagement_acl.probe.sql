-- READ-ONLY probe for 20261011150200_home_v1_congrats_feed_comments_signing_tags.sql.
SELECT CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.feed_congrats'::regclass) THEN 'PASS' ELSE 'FAIL' END AS status, 'feed_congrats RLS on' AS chk
UNION ALL SELECT CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.feed_item_comments'::regclass) THEN 'PASS' ELSE 'FAIL' END, 'feed_item_comments RLS on'
UNION ALL SELECT CASE WHEN NOT has_table_privilege('anon', 'public.feed_congrats', 'SELECT') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot read congrats rows'
UNION ALL SELECT CASE WHEN NOT has_table_privilege('authenticated', 'public.feed_congrats', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.feed_congrats', 'DELETE') THEN 'PASS' ELSE 'FAIL' END, 'congrats writes only via RPC'
UNION ALL SELECT CASE WHEN NOT has_table_privilege('authenticated', 'public.feed_item_comments', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.feed_item_comments', 'UPDATE') THEN 'PASS' ELSE 'FAIL' END, 'feed comments writes only via RPC'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.toggle_congrats(text, uuid)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot congrats'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.create_feed_item_comment(uuid, text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot comment'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.remove_signing_tag(uuid)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot remove tags'
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_post_comment_insert') THEN 'PASS' ELSE 'FAIL' END, 'post comment guard trigger'
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_signing_tag') THEN 'PASS' ELSE 'FAIL' END, 'signing 18+ guard trigger'
UNION ALL SELECT CASE WHEN position('profile_is_adult' in pg_get_functiondef('public.search_people_for_signing(text, integer)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'signing search 18+';
