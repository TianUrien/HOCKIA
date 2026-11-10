-- Probe for 20261110150000_ban_evasion_guard.sql (staging only; rolls itself back).
-- Checks: Gmail/plus normalisation; blocking an account bans its email and
-- unblocking frees it; a new profile for an alias of a banned email is refused
-- while an unrelated email is fine; a second account on the blocked account's
-- device is listed as a suspect (device match), and only for admins; clients
-- cannot read banned_emails.
do $$
declare
  a uuid; s uuid; adm uuid; n int; err text; results text := ''; r jsonb; ok boolean;
  a_email text; alias text;
begin
  results := results || format(E'%s gmail dots and +tag normalise (%s)\n',
    case when normalize_email_for_ban('A.b.C+spam@GoogleMail.com') = 'abc@gmail.com' then 'PASS' else 'FAIL' end, normalize_email_for_ban('A.b.C+spam@GoogleMail.com'));
  results := results || format(E'%s other domains keep dots, drop +tag (%s)\n',
    case when normalize_email_for_ban('a.b+x@Club.org') = 'a.b@club.org' then 'PASS' else 'FAIL' end, normalize_email_for_ban('a.b+x@Club.org'));

  select p.id, u.email into a, a_email from profiles p join auth.users u on u.id = p.id
   where p.onboarding_completed and not p.is_blocked and coalesce(p.is_test_account, false) = false and u.email like '%@gmail.com' order by p.created_at limit 1;
  select p.id into s from profiles p where p.onboarding_completed and not p.is_blocked and p.id <> a and coalesce(p.is_test_account, false) = false order by p.created_at desc limit 1;
  select u.id into adm from auth.users u where u.raw_app_meta_data->>'is_admin' = 'true' limit 1;

  -- Block A (as the server would through admin_block_user's UPDATE).
  update profiles set is_blocked = true, blocked_at = now(), blocked_reason = 'probe' where id = a;
  select count(*) into n from banned_emails where source_profile_id = a and email_normalized = normalize_email_for_ban(a_email);
  results := results || format(E'%s blocking bans the email (%s row)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- A new signup using an alias of the banned mailbox is refused.
  alias := replace(split_part(a_email, '@', 1), '.', '') || '+back@gmail.com';
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    insert into profiles (id, email, role, full_name, base_location, nationality) values (gen_random_uuid(), alias, 'player', '', '', '');
    err := 'none';
  exception when others then err := sqlstate || ' ' || sqlerrm;
  end;
  results := results || format(E'%s alias of a banned email cannot create a profile (%s)\n', case when err like '42501%can''t be created%' then 'PASS' else 'FAIL' end, err);

  -- An unrelated email passes the guard (it may fail later on the auth FK, which is not this guard).
  begin
    insert into profiles (id, email, role, full_name, base_location, nationality) values (gen_random_uuid(), 'probe-unrelated-' || gen_random_uuid() || '@example.org', 'player', '', '', '');
    err := 'none';
  exception when others then err := sqlstate || ' ' || sqlerrm;
  end;
  results := results || format(E'%s unrelated email is not refused by the guard (%s)\n', case when err not like '%can''t be created%' then 'PASS' else 'FAIL' end, left(err, 60));
  perform set_config('request.jwt.claims', '{}', true);

  -- S used A's device.
  insert into events (event_name, user_id, anonymous_id, ip_hash) values ('probe', a, 'probe-device-1', 'probe-ip-a');
  insert into events (event_name, user_id, anonymous_id, ip_hash) values ('probe', s, 'probe-device-1', 'probe-ip-s');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated', 'app_metadata', json_build_object('is_admin', true))::text, true);
  perform set_config('role', 'authenticated', true);
  r := admin_get_ban_evasion_suspects();
  select exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'profile_id' = s::text and x->>'match' = 'device' and x->>'blocked_profile_id' = a::text) into ok;
  results := results || format(E'%s admin sees the same-device account as a suspect (%s)\n', case when ok then 'PASS' else 'FAIL' end, ok);
  select not exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'profile_id' = a::text) into ok;
  results := results || format(E'%s the blocked account itself is not listed (%s)\n', case when ok then 'PASS' else 'FAIL' end, ok);

  -- A regular member.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  begin perform admin_get_ban_evasion_suspects(); err := 'none'; exception when others then err := sqlerrm; end;
  results := results || format(E'%s a member cannot read suspects (%s)\n', case when err = 'Unauthorized' then 'PASS' else 'FAIL' end, err);
  begin select count(*) into n from banned_emails; err := 'read ' || n; exception when others then err := sqlstate; end;
  results := results || format(E'%s a member cannot read banned_emails (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);

  -- Unblock frees the email.
  update profiles set is_blocked = false, blocked_at = null, blocked_reason = null where id = a;
  select count(*) into n from banned_emails where source_profile_id = a;
  results := results || format(E'%s unblocking frees the email (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);

  select has_function_privilege('anon', 'public.admin_get_ban_evasion_suspects()', 'execute') into ok;
  results := results || format(E'%s anon cannot execute the suspects RPC (%s)\n', case when not ok then 'PASS' else 'FAIL' end, ok);

  raise exception E'probe done, rolled back:\n%', results;
end $$;
