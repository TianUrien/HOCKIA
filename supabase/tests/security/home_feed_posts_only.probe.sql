-- READ-ONLY probe for 20261124150000_home_feed_posts_only.sql.
-- As the oldest onboarded member: with p_posts_only the feed holds member
-- posts only; without it the feed is what it was; anon keeps its grant and
-- the three-argument function is gone.
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM profiles WHERE onboarding_completed AND NOT COALESCE(is_blocked, false) AND frozen_minor_at IS NULL ORDER BY created_at LIMIT 1), 'role', 'authenticated')::text, true);
WITH only_posts AS (
  SELECT jsonb_array_elements(public.get_home_feed_v2(50, 0, true, true)->'items') AS it
), full_feed AS (
  SELECT public.get_home_feed_v2(50, 0, true) AS r
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM only_posts WHERE it->>'item_type' <> 'user_post') THEN 'PASS' ELSE 'FAIL' END AS status, 'posts only: every item is a member post' AS chk
UNION ALL
SELECT CASE WHEN (SELECT (r->>'total')::int FROM full_feed) >= (SELECT count(*) FROM only_posts) THEN 'PASS' ELSE 'FAIL' END, 'the default feed still returns at least as many items'
UNION ALL
SELECT CASE WHEN has_function_privilege('authenticated', 'public.get_home_feed_v2(integer,integer,boolean,boolean)', 'EXECUTE') AND has_function_privilege('anon', 'public.get_home_feed_v2(integer,integer,boolean,boolean)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'grants kept'
UNION ALL
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_home_feed_v2' AND pronargs = 3) THEN 'PASS' ELSE 'FAIL' END, 'no three-argument overload left (no ambiguity)'
UNION ALL
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.get_home_posts_new_count(timestamptz)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.get_home_posts_new_count(timestamptz)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'new posts count: members only'
UNION ALL
SELECT CASE WHEN position('profile_is_hidden' in pg_get_functiondef('public.get_home_posts_new_count(timestamptz)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'new posts count applies the hidden-profile fence';
