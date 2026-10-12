-- READ-ONLY probe for 20261012140000_brand_country_edit.sql.
SELECT CASE WHEN to_regprocedure('public.update_brand(text,text,text,text,text,text,text,boolean)') IS NULL
             AND to_regprocedure('public.update_brand(text,text,text,text,text,text,text,boolean,integer)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status, 'update_brand: one overload with country' AS chk
UNION ALL SELECT CASE WHEN NOT has_function_privilege('anon', 'public.update_brand(text,text,text,text,text,text,text,boolean,integer)', 'EXECUTE')
                       AND has_function_privilege('authenticated', 'public.update_brand(text,text,text,text,text,text,text,boolean,integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'update_brand: authenticated only'
UNION ALL SELECT CASE WHEN position('Invalid country' in pg_get_functiondef('public.update_brand(text,text,text,text,text,text,text,boolean,integer)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, 'country validated';
