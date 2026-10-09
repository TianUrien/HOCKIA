-- READ-ONLY probe for 20261009200000_club_flow_fixes.sql: every function the
-- migration created or redefined has the expected security mode, search_path
-- and ACL, the bodies carry the new rules, and the triggers are in place. No
-- writes, no identity switches: safe for the MCP execute_sql tool and for prod.
-- Behaviour checks need fixtures: see club_flow_fixes.probe.sql (staging, rolled back).
--
-- Expected values, recorded from the migration:
--   function                                        definer  anon  authenticated  service_role
--   handle_opportunity_application_notifications()  yes      no    no             (not asserted)
-- "not asserted": the migration neither grants nor revokes service_role.
-- PUBLIC must hold nothing on any of them. All have search_path=public.
--
-- Returns one row per check: status (PASS / FAIL), check, detail. Every row must be PASS.

WITH expected(sig, anon_x, auth_x, service_x) AS (
  VALUES ('public.handle_opportunity_application_notifications()', false, false, NULL::boolean)
),
shape AS (
  SELECT e.*, p.oid, p.prosecdef, p.proacl,
         coalesce(array_to_string(p.proconfig, ','), '') AS cfg
    FROM expected e
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
),
checks(status, name, detail) AS (
  SELECT CASE WHEN s.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'E1 exists: ' || s.sig, coalesce(s.oid::text, 'missing')
    FROM shape s
  UNION ALL
  SELECT CASE WHEN s.prosecdef AND s.cfg ILIKE '%search_path=public%' THEN 'PASS' ELSE 'FAIL' END,
         'F1 definer + search_path: ' || s.sig, coalesce(s.prosecdef::text, 'NULL') || ' ' || s.cfg
    FROM shape s
  UNION ALL
  SELECT CASE WHEN has_function_privilege('anon', s.oid, 'EXECUTE') = s.anon_x
               AND has_function_privilege('authenticated', s.oid, 'EXECUTE') = s.auth_x
               AND (s.service_x IS NULL OR has_function_privilege('service_role', s.oid, 'EXECUTE') = s.service_x)
              THEN 'PASS' ELSE 'FAIL' END,
         'X1 grants as recorded: ' || s.sig,
         format('anon=%s authenticated=%s service_role=%s acl=%s',
                has_function_privilege('anon', s.oid, 'EXECUTE'),
                has_function_privilege('authenticated', s.oid, 'EXECUTE'),
                has_function_privilege('service_role', s.oid, 'EXECUTE'),
                coalesce(s.proacl::text, 'NULL'))
    FROM shape s WHERE s.oid IS NOT NULL
  UNION ALL
  -- PUBLIC holds nothing: an ACL entry with an empty grantee ("=X/owner") is PUBLIC.
  -- A NULL proacl would mean the built-in default (PUBLIC may execute).
  SELECT CASE WHEN s.proacl IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM aclexplode(s.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END,
         'X2 nothing for PUBLIC: ' || s.sig, coalesce(s.proacl::text, 'NULL')
    FROM shape s WHERE s.oid IS NOT NULL
  UNION ALL
  -- Rules that must be in the bodies (one marker per rule).
  SELECT CASE WHEN pg_get_functiondef(to_regprocedure(g.sig)) ILIKE '%' || g.marker || '%' THEN 'PASS' ELSE 'FAIL' END,
         'B1 body rule: ' || g.sig || ' · ' || g.marker, ''
    FROM (VALUES
      ('public.handle_opportunity_application_notifications()', 'NEW.status = ''rejected'''),
      ('public.handle_opportunity_application_notifications()', 'OLD.status IN (''pending'', ''maybe'')'),
      ('public.handle_opportunity_application_notifications()', 'role_organisation('),
      ('public.handle_opportunity_application_notifications()', 'SET emailed_at = NULL'),
      ('public.handle_opportunity_application_notifications()', 'application_status_email_queue')
    ) AS g(sig, marker)
  UNION ALL
  -- Triggers that must exist and be enabled.
  SELECT CASE WHEN t.oid IS NOT NULL AND t.tgenabled <> 'D' THEN 'PASS' ELSE 'FAIL' END,
         'T1 trigger: ' || x.tbl || '.' || x.tg, coalesce(pg_get_triggerdef(t.oid), 'missing')
    FROM (VALUES
      ('opportunity_applications', 'opportunity_applications_notify')
    ) AS x(tbl, tg)
    LEFT JOIN pg_trigger t ON t.tgrelid = ('public.' || x.tbl)::regclass AND t.tgname = x.tg AND NOT t.tgisinternal
)
SELECT status, name AS check, detail FROM checks ORDER BY name;
