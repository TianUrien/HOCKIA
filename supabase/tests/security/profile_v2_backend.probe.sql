-- READ-ONLY probe for 20261012100000_profile_v2_backend.sql.
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.get_my_product_tap_stats(integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS status, 'anon cannot read product taps' AS chk
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.profile_completeness_parts(public.profiles)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot call completeness parts'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.get_my_profile_completeness()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon cannot read own completeness'
UNION ALL SELECT CASE WHEN position('profile_is_uncontactable' in pg_get_functiondef('public.get_club_members(uuid,integer,integer)'::regprocedure)) > 0
                       AND position('user_blocks' in pg_get_functiondef('public.get_club_members(uuid,integer,integer)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'squad: uncontactable + block fences'
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='cover_url')
                       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='open_to_partners') THEN 'PASS' ELSE 'FAIL' END, 'brands cover + open_to_partners'
UNION ALL SELECT CASE WHEN position('''appointments'', ''weight'', 20' in pg_get_functiondef('public.profile_completeness_parts(public.profiles)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'umpire appointments weight 20';
