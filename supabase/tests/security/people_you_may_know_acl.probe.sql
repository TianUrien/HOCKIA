-- READ-ONLY probe for 20261011150400_people_you_may_know.sql.
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.get_people_you_may_know(integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS status, 'anon cannot execute' AS chk
UNION ALL SELECT CASE WHEN has_function_privilege('authenticated', 'public.get_people_you_may_know(integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'authenticated can execute'
UNION ALL SELECT CASE WHEN position('profile_is_adult' in pg_get_functiondef('public.get_people_you_may_know(integer)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, '18+ for club-facing viewers'
UNION ALL SELECT CASE WHEN position('is_blocked_pair' in pg_get_functiondef('public.get_people_you_may_know(integer)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'block fence';
