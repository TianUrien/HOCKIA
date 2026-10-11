-- READ-ONLY probe for 20261011160000_opportunity_deadline_validation.sql.
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.opportunities WHERE application_deadline < DATE '2020-01-01') THEN 'PASS' ELSE 'FAIL' END AS status, 'no deadlines before 2020' AS chk
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_application_deadline_range' AND convalidated) THEN 'PASS' ELSE 'FAIL' END, 'range constraint validated'
UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_opportunity_deadline' AND tgenabled = 'O') THEN 'PASS' ELSE 'FAIL' END, 'deadline guard trigger enabled'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.guard_opportunity_deadline()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'guard not callable by clients'
UNION ALL SELECT CASE WHEN (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.opportunities'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'O') = 0 THEN 'PASS' ELSE 'FAIL' END, 'all opportunities triggers re-enabled';
