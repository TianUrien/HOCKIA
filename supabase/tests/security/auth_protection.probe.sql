-- Probe for 20261111100000_auth_protection.sql (staging only; rolls itself back).
-- Checks: with both switches off nothing is refused and attempts over the
-- threshold are marked would_limit; with the rate-limit switch on the 11th
-- attempt from one device is refused, another device on the same network is
-- not, and the network ceiling refuses everyone; the bot-check switch asks
-- for a token, refuses a bad one and never refuses when the verifier is
-- unavailable; the Auth hook counts new accounts and refuses only with the
-- switch on; no raw address or user agent is stored; clients can neither read
-- the table nor call the server functions; only admins read the summary.
do $$
declare
  results text := ''; r jsonb; n int; i int; err text; ok boolean; adm uuid; member uuid;
  ip text := '203.0.113.77'; ua text := 'Mozilla/5.0 (Linux; Android 11; IN2023; wv) probe';
  ev jsonb;
begin
  delete from app_settings where key like 'auth_%';

  -- 1 · switches off: never refused, the 11th is marked would_limit.
  for i in 1..11 loop
    r := auth_guard_check('oauth_start', 'apple', ip, ua, 'install-a', 'Android 11 · IN2023 · WebView', 'android', '1.26', 'AR', 'none');
  end loop;
  results := results || format(E'%s switches off: 11th attempt allowed (%s)\n', case when (r->>'allowed')::boolean and r->>'outcome' = 'would_limit' then 'PASS' else 'FAIL' end, r);

  -- 2 · no raw values stored.
  select count(*) into n from auth_attempts where ip_hash = ip or ip_hash like '%203.0.113%' or device_hash like '%Mozilla%' or device_label like '%203.0.113%';
  results := results || format(E'%s address and user agent are stored only as hashes (%s raw rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(distinct ip_hash) into n from auth_attempts where ip_hash = auth_guard_hash(ip) and length(ip_hash) = 32;
  results := results || format(E'%s the same address always gives the same 32-character hash (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- 3 · rate limit on: same device refused, with a wait.
  insert into app_settings (key, value) values ('auth_rate_limit_enabled', 'true');
  r := auth_guard_check('oauth_start', 'apple', ip, ua, 'install-a', 'x', 'android', '1.26', 'AR', 'none');
  results := results || format(E'%s limit on: the device over 10 in 5 minutes is refused (%s)\n', case when not (r->>'allowed')::boolean and r->>'reason' = 'rate_limited' and (r->>'retry_after')::int between 30 and 300 then 'PASS' else 'FAIL' end, r);

  -- 4 · another device on the same network is not refused (shared wifi).
  r := auth_guard_check('oauth_start', 'google', ip, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) probe', 'install-b', 'iPhone · iOS 18', 'ios', '1.3.25', 'AR', 'none');
  results := results || format(E'%s limit on: a second device on the same network is allowed (%s)\n', case when (r->>'allowed')::boolean then 'PASS' else 'FAIL' end, r);

  -- 5 · another kind from the refused device is counted separately.
  r := auth_guard_check('password_signin', null, ip, ua, 'install-a', 'x', 'android', '1.26', 'AR', 'none');
  results := results || format(E'%s limit on: a different kind has its own count (%s)\n', case when (r->>'allowed')::boolean then 'PASS' else 'FAIL' end, r);

  -- 6 · network ceiling: 40 from many devices, then everyone on it is refused.
  for i in 1..40 loop
    perform auth_guard_check('signup', null, '203.0.113.78', 'probe-ua-' || i, 'install-' || i, 'x', 'web', null, 'AR', 'none');
  end loop;
  r := auth_guard_check('signup', null, '203.0.113.78', 'probe-ua-new', 'install-new', 'x', 'web', null, 'AR', 'none');
  results := results || format(E'%s limit on: the network ceiling of 40 refuses a new device (%s)\n', case when not (r->>'allowed')::boolean and r->>'reason' = 'rate_limited' then 'PASS' else 'FAIL' end, r);

  -- 7 · an override in app_settings changes the threshold.
  insert into app_settings (key, value) values ('auth_limit_device_max', '2');
  perform auth_guard_check('magic_link', null, '203.0.113.79', ua, 'install-c', 'x', 'web', null, null, 'none');
  perform auth_guard_check('magic_link', null, '203.0.113.79', ua, 'install-c', 'x', 'web', null, null, 'none');
  r := auth_guard_check('magic_link', null, '203.0.113.79', ua, 'install-c', 'x', 'web', null, null, 'none');
  results := results || format(E'%s the device threshold can be overridden (%s)\n', case when not (r->>'allowed')::boolean then 'PASS' else 'FAIL' end, r);
  delete from app_settings where key in ('auth_limit_device_max', 'auth_rate_limit_enabled');

  -- 8 · bot-check switch.
  insert into app_settings (key, value) values ('auth_turnstile_enforced', 'true');
  r := auth_guard_check('password_reset', null, '203.0.113.80', ua, 'install-d', 'x', 'web', null, null, 'none');
  results := results || format(E'%s bot check on: no token asks for one (%s)\n', case when r->>'reason' = 'captcha_required' then 'PASS' else 'FAIL' end, r);
  r := auth_guard_check('password_reset', null, '203.0.113.80', ua, 'install-d', 'x', 'web', null, null, 'invalid');
  results := results || format(E'%s bot check on: a bad token is refused (%s)\n', case when r->>'reason' = 'captcha_failed' then 'PASS' else 'FAIL' end, r);
  r := auth_guard_check('password_reset', null, '203.0.113.80', ua, 'install-d', 'x', 'web', null, null, 'valid');
  results := results || format(E'%s bot check on: a good token is allowed (%s)\n', case when (r->>'allowed')::boolean then 'PASS' else 'FAIL' end, r);
  r := auth_guard_check('password_reset', null, '203.0.113.80', ua, 'install-d', 'x', 'web', null, null, 'unavailable');
  results := results || format(E'%s bot check on: an unavailable verifier never refuses (%s)\n', case when (r->>'allowed')::boolean then 'PASS' else 'FAIL' end, r);
  delete from app_settings where key = 'auth_turnstile_enforced';

  -- 9 · failed sign-in report is recorded as observed; unknown kinds are ignored.
  perform auth_guard_report('password_signin_failed', '203.0.113.81', ua, 'install-e', 'x', 'web', null, null);
  perform auth_guard_report('anything_else', '203.0.113.81', ua, 'install-e', 'x', 'web', null, null);
  select count(*) into n from auth_attempts where ip_hash = auth_guard_hash('203.0.113.81');
  results := results || format(E'%s a failed sign-in is recorded once, other reports ignored (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  r := auth_guard_check('delete_everything', null, ip, ua, 'x', 'x', 'web', null, null, 'none');
  results := results || format(E'%s an unknown kind is allowed and not recorded (%s)\n', case when r->>'outcome' = 'ignored' then 'PASS' else 'FAIL' end, r);

  -- 10 · Auth hook: counts, and refuses only with the switch on.
  ev := jsonb_build_object('metadata', jsonb_build_object('ip_address', '203.0.113.82', 'name', 'before-user-created'),
                           'user', jsonb_build_object('app_metadata', jsonb_build_object('provider', 'apple')));
  for i in 1..31 loop r := hook_before_user_created(ev); end loop;
  select count(*) filter (where outcome = 'allowed'), count(*) filter (where outcome = 'would_limit') into n, i
    from auth_attempts where source = 'hook' and ip_hash = auth_guard_hash('203.0.113.82');
  results := results || format(E'%s hook, switch off: 31st new account allowed and marked (%s, %s allowed, %s would_limit)\n', case when r = '{}'::jsonb and n = 30 and i = 1 then 'PASS' else 'FAIL' end, r, n, i);
  insert into app_settings (key, value) values ('auth_rate_limit_enabled', 'true');
  r := hook_before_user_created(ev);
  results := results || format(E'%s hook, switch on: over 30 an hour is refused with 429 (%s)\n', case when (r->'error'->>'http_code')::int = 429 then 'PASS' else 'FAIL' end, r);
  r := hook_before_user_created(jsonb_build_object('metadata', jsonb_build_object('ip_address', '203.0.113.83'), 'user', '{}'::jsonb));
  results := results || format(E'%s hook, switch on: another network is allowed (%s)\n', case when r = '{}'::jsonb then 'PASS' else 'FAIL' end, r);
  r := hook_before_user_created('"not an object"'::jsonb);
  results := results || format(E'%s hook: a malformed event never blocks sign-up (%s)\n', case when r = '{}'::jsonb then 'PASS' else 'FAIL' end, r);
  delete from app_settings where key = 'auth_rate_limit_enabled';

  select has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute') into ok;
  results := results || format(E'%s Supabase Auth may run the hook (%s)\n', case when ok then 'PASS' else 'FAIL' end, ok);

  -- 11 · retention.
  insert into auth_attempts (source, kind, outcome, created_at) values ('guard', 'signup', 'allowed', now() - interval '31 days');
  n := prune_auth_attempts();
  results := results || format(E'%s rows older than 30 days are pruned (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- 12 · admin summary: admin only.
  select u.id into adm from auth.users u where u.raw_app_meta_data->>'is_admin' = 'true' limit 1;
  select p.id into member from profiles p where p.onboarding_completed and not p.is_blocked and p.id <> adm limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  perform set_config('role', 'authenticated', true);
  r := admin_get_auth_attempts(1);
  select exists (select 1 from jsonb_array_elements(r->'sources') s where (s->>'attempts')::int >= 11 and (s->>'would_limit')::int >= 1 and length(s->>'network') = 8)
     and r::text not like '%203.0.113%'
     and (r->>'rate_limit_enabled')::boolean = false and (r->>'turnstile_enforced')::boolean = false
    into ok;
  results := results || format(E'%s admin reads the summary; switches read off; no address in it (%s sources)\n', case when ok then 'PASS' else 'FAIL' end, jsonb_array_length(r->'sources'));

  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  begin perform admin_get_auth_attempts(1); err := 'none'; exception when others then err := sqlerrm; end;
  results := results || format(E'%s a member cannot read the summary (%s)\n', case when err = 'Unauthorized' then 'PASS' else 'FAIL' end, err);

  -- 13 · clients cannot touch the table, the key or the server functions.
  begin select count(*) into n from auth_attempts; err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s a member cannot read auth_attempts (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  begin select count(*) into n from auth_guard_keys; err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s a member cannot read the hash key (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  begin perform auth_guard_check('signup', null, ip, ua, 'x', 'x', 'web', null, null, 'valid'); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s a member cannot call auth_guard_check (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  begin perform hook_before_user_created(ev); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s a member cannot call the hook (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  begin perform auth_guard_hash('203.0.113.1'); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s a member cannot call the hash function (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  perform set_config('role', 'anon', true);
  begin perform auth_guard_check('signup', null, ip, ua, 'x', 'x', 'web', null, null, 'valid'); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s anon cannot call auth_guard_check (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  begin perform admin_get_auth_attempts(1); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s anon cannot call the admin summary (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);

  raise exception E'PROBE RESULTS (rolled back):\n%', results;
end $$;
