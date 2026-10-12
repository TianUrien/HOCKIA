-- READ-ONLY probe for 20261012120000_brand_profile_v2.sql.
SELECT CASE WHEN position('cover_url' in pg_get_functiondef('public.get_brand_by_slug(text)'::regprocedure)) > 0
             AND position('open_to_partners' in pg_get_functiondef('public.get_brand_by_slug(text)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END AS status, 'brand by slug returns cover + partners' AS chk
UNION ALL SELECT CASE WHEN position('open_to_partners' in pg_get_functiondef('public.get_my_brand()'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'my brand returns partners'
UNION ALL SELECT CASE WHEN to_regprocedure('public.get_brands(text,text,integer,integer)') IS NULL
                       AND to_regprocedure('public.get_brands(text,text,integer,integer,boolean)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'get_brands: one overload with partners filter'
UNION ALL SELECT CASE WHEN has_function_privilege('anon', 'public.get_brands(text,text,integer,integer,boolean)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'anon can list brands'
UNION ALL SELECT CASE WHEN to_regprocedure('public.update_brand(text,text,text,text,text,text)') IS NULL THEN 'PASS' ELSE 'FAIL' END, 'update_brand: old overload gone'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.update_brand(text,text,text,text,text,text,text,boolean)', 'EXECUTE')
                       AND has_function_privilege('authenticated', 'public.update_brand(text,text,text,text,text,text,text,boolean)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'update_brand: authenticated only';
