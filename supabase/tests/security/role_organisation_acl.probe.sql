-- READ-ONLY probe for 20261004200000_role_organisation_name.sql: the helper's
-- shape and grants, and that every function the migration redefined kept its
-- security mode, search_path and ACL. No writes, no identity switches: safe for
-- the MCP execute_sql tool and for prod. Behaviour checks need fixtures: see
-- role_organisation.probe.sql (staging, rolled back).
--
-- Expected values, recorded from the source migrations:
--   function                              definer  anon  authenticated  service_role   source of the grants
--   role_organisation(uuid)               yes      no    no             yes            20261004200000 (new)
--   _fill_waiting_applications(uuid)      yes      no    no             (not asserted) 20260928120000 (REVOKE ALL FROM PUBLIC, anon, authenticated)
--   send_invite(uuid, uuid, text)         yes      no    yes            yes            20261001210000
--   make_offer(uuid, date, date, text, text, text[], text)
--                                         yes      no    yes            (not asserted) 20260928120000
--   withdraw_offer(uuid)                  yes      no    yes            (not asserted) 20260928120000
--   mark_signed(uuid, boolean)            yes      no    yes            (not asserted) 20260928120000
--   undo_mark_signed(uuid)                yes      no    yes            (not asserted) 20260928120000
--   confirm_signing(uuid, boolean)        yes      no    yes            yes            20261003100000
-- "not asserted": the source migration neither grants nor revokes service_role,
-- so its value is whatever the default ACL gave when the function was created.
-- PUBLIC must hold nothing on any of them. All have search_path=public.
--
-- Returns one row per check: status (PASS / FAIL), check, detail. Every row must be PASS.

WITH expected(sig, anon_x, auth_x, service_x) AS (
  VALUES ('public.role_organisation(uuid)',                                          false, false, true),
         ('public._fill_waiting_applications(uuid)',                                 false, false, NULL::boolean),
         ('public.send_invite(uuid, uuid, text)',                                    false, true,  true),
         ('public.make_offer(uuid, date, date, text, text, text[], text)',           false, true,  NULL::boolean),
         ('public.withdraw_offer(uuid)',                                             false, true,  NULL::boolean),
         ('public.mark_signed(uuid, boolean)',                                       false, true,  NULL::boolean),
         ('public.undo_mark_signed(uuid)',                                           false, true,  NULL::boolean),
         ('public.confirm_signing(uuid, boolean)',                                   false, true,  true)
),
shape AS (
  SELECT e.*, p.oid, p.prosecdef, p.proacl,
         coalesce(array_to_string(p.proconfig, ','), '') AS cfg,
         pg_get_function_result(p.oid) AS result,
         p.provolatile
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
  SELECT CASE WHEN s.result = 'TABLE(name text, world_club_id uuid)' AND s.provolatile = 's' THEN 'PASS' ELSE 'FAIL' END,
         'H1 role_organisation returns (name, world_club_id), STABLE', coalesce(s.result, 'NULL') || ' ' || coalesce(s.provolatile::text, 'NULL')
    FROM shape s WHERE s.sig = 'public.role_organisation(uuid)'
  UNION ALL
  SELECT CASE WHEN bool_and(pg_get_function_result(s.oid) = 'jsonb') THEN 'PASS' ELSE 'FAIL' END,
         'H2 the six client functions still return jsonb', string_agg(pg_get_function_result(s.oid), ',')
    FROM shape s WHERE s.oid IS NOT NULL AND s.sig NOT IN ('public.role_organisation(uuid)', 'public._fill_waiting_applications(uuid)')
  UNION ALL
  SELECT CASE WHEN pg_get_function_result(s.oid) = 'integer' THEN 'PASS' ELSE 'FAIL' END,
         'H3 _fill_waiting_applications still returns integer', pg_get_function_result(s.oid)
    FROM shape s WHERE s.oid IS NOT NULL AND s.sig = 'public._fill_waiting_applications(uuid)'
  UNION ALL
  -- Each redefined body resolves the name through the helper.
  SELECT CASE WHEN pg_get_functiondef(s.oid) ILIKE '%role_organisation(%' THEN 'PASS' ELSE 'FAIL' END,
         'B1 uses role_organisation: ' || s.sig, ''
    FROM shape s WHERE s.oid IS NOT NULL AND s.sig <> 'public.role_organisation(uuid)'
  UNION ALL
  -- Guards that must still be in the bodies (one marker per function).
  SELECT CASE WHEN pg_get_functiondef(to_regprocedure(g.sig)) ILIKE '%' || g.marker || '%' THEN 'PASS' ELSE 'FAIL' END,
         'B2 guard kept: ' || g.sig || ' · ' || g.marker, ''
    FROM (VALUES
      ('public.send_invite(uuid, uuid, text)', 'profile_is_adult'),
      ('public.send_invite(uuid, uuid, text)', 'This player passed on this role'),
      ('public.send_invite(uuid, uuid, text)', 'Daily invite limit reached'),
      ('public.send_invite(uuid, uuid, text)', 'is_blocked_pair'),
      ('public.make_offer(uuid, date, date, text, text, text[], text)', 'Offers can be made to shortlisted applicants only'),
      ('public.make_offer(uuid, date, date, text, text, text[], text)', 'is_minor'),
      ('public.withdraw_offer(uuid)', 'Only an offer still waiting for an answer can be withdrawn'),
      ('public.mark_signed(uuid, boolean)', 'Only a shortlisted applicant or an accepted offer can be marked as signed'),
      ('public.undo_mark_signed(uuid)', 'Only a signing still waiting for the player can be undone'),
      ('public.confirm_signing(uuid, boolean)', 'This signing request has expired'),
      ('public.confirm_signing(uuid, boolean)', '_apply_signing_current_club'),
      ('public.confirm_signing(uuid, boolean)', 'applicant_id IS DISTINCT FROM v_uid')
    ) AS g(sig, marker)
)
SELECT status, name AS check, detail FROM checks ORDER BY name;
