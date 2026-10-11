-- READ-ONLY probe for 20261011150500_home_v1_signing_details_new_members.sql.
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.create_signing_post(uuid,text,jsonb,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS status, 'anon cannot create signing posts' AS chk
UNION ALL SELECT CASE WHEN has_function_privilege('authenticated', 'public.create_signing_post(uuid,text,jsonb,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'authenticated can create signing posts'
UNION ALL SELECT CASE WHEN to_regprocedure('public.create_signing_post(uuid,text,jsonb)') IS NULL THEN 'PASS' ELSE 'FAIL' END, 'old 3-arg overload dropped'
UNION ALL SELECT CASE WHEN position('club_name' in pg_get_functiondef('public.create_signing_post(uuid,text,jsonb,text,text)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'metadata carries club_name for the tag notification'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.get_new_members(integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot list new members'
UNION ALL SELECT CASE WHEN has_function_privilege('authenticated', 'public.get_new_members(integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'authenticated can list new members'
UNION ALL SELECT CASE WHEN NOT p.prosecdef THEN 'PASS' ELSE 'FAIL' END, 'get_new_members is SECURITY INVOKER' FROM pg_proc p WHERE p.oid = 'public.get_new_members(integer)'::regprocedure;
