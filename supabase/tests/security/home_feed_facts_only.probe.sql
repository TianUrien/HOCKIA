-- Probe for 20261110190000_home_feed_facts_only.sql and
-- 20261110200000_home_feed_open_to_play_recent.sql (staging only; rolls itself back).
-- As a member: the Home feed has no photos, videos or milestones; the
-- "open to play" card is absent unless asked for; when asked for there is
-- exactly one, listing the players who confirmed in the last 7 days, never
-- the viewer, an admin-blocked player, one who is no longer open to play or
-- a confirmation older than 7 days; and two-argument calls still work.
do $$
declare
  v uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
  r jsonb; card jsonb; n int; results text := ''; bad int; ids text;
begin
  select id into v from profiles where onboarding_completed and not is_blocked and frozen_minor_at is null order by created_at limit 1;
  select id into p1 from profiles where role = 'player' and onboarding_completed and not is_blocked and frozen_minor_at is null and id <> v order by created_at desc limit 1;
  select id into p2 from profiles where role = 'player' and onboarding_completed and not is_blocked and frozen_minor_at is null and id not in (v, p1) order by created_at desc limit 1;
  select id into p3 from profiles where role = 'player' and onboarding_completed and not is_blocked and frozen_minor_at is null and id not in (v, p1, p2) order by created_at desc limit 1;
  select id into p4 from profiles where role = 'player' and onboarding_completed and not is_blocked and frozen_minor_at is null and id not in (v, p1, p2, p3) order by created_at desc limit 1;
  select id into p5 from profiles where role = 'player' and onboarding_completed and not is_blocked and frozen_minor_at is null and id not in (v, p1, p2, p3, p4) order by created_at desc limit 1;

  update profiles set open_to_play = true where id in (p1, p2, p3, p4, p5);
  update profiles set open_to_play = true where id = v and role = 'player';
  -- Start from an empty window. After the profile updates on purpose: turning
  -- "open to play" on creates a fresh confirmation through the app's own
  -- trigger, which would put that player in the last 7 days.
  delete from home_feed_items where item_type = 'open_to_play_confirmed' and (created_at > now() - interval '9 days' or author_profile_id in (v, p1, p2, p3, p4, p5));
  insert into home_feed_items (item_type, source_id, source_type, metadata, author_profile_id, author_role, created_at, is_test_account)
  select 'open_to_play_confirmed', x.id, 'profile', jsonb_build_object('player_id', x.id), x.id, 'player', x.at,
         coalesce((select is_test_account from profiles where id = x.id), false)
  from (values (p1, now() - interval '4 hours'), (p2, now() - interval '3 hours'), (p3, now() - interval '2 hours'), (p4, now() - interval '1 hour'),
               (v, now() - interval '30 minutes'), (p5, now() - interval '8 days')) as x(id, at);

  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- Existing call shape (older clients): works, and carries no new card.
  r := get_home_feed_v2(50, 0);
  select count(*) into bad from jsonb_array_elements(r->'items') x where x->>'item_type' in ('media_added', 'video_added', 'milestone_achieved');
  results := results || format(E'%s no photos, videos or milestones in the feed (%s found)\n', case when bad = 0 then 'PASS' else 'FAIL' end, bad);
  select count(*) into n from jsonb_array_elements(r->'items') x where x->>'item_type' = 'open_to_play_week';
  results := results || format(E'%s two-argument call has no open-to-play card (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Asked for: exactly one card.
  r := get_home_feed_v2(50, 0, true);
  select count(*) into n from jsonb_array_elements(r->'items') x where x->>'item_type' = 'open_to_play_week';
  results := results || format(E'%s exactly one open-to-play card (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select x into card from jsonb_array_elements(r->'items') x where x->>'item_type' = 'open_to_play_week';
  select string_agg(m->>'id', ',') into ids from jsonb_array_elements(card->'members') m;
  results := results || format(E'%s the card lists the 4 other recent players (member_count %s)\n',
    case when (card->>'member_count')::int = 4 and ids like '%' || p1 || '%' and ids like '%' || p4 || '%' then 'PASS' else 'FAIL' end, card->>'member_count');
  results := results || format(E'%s the viewer is not on their own card\n', case when ids not like '%' || v || '%' then 'PASS' else 'FAIL' end);
  results := results || format(E'%s a confirmation older than 7 days is left out\n', case when ids not like '%' || p5 || '%' then 'PASS' else 'FAIL' end);
  results := results || format(E'%s newest confirmation first (%s)\n', case when card->'members'->0->>'id' = p4::text then 'PASS' else 'FAIL' end, card->'members'->0->>'id' = p4::text);
  select count(*) into bad from jsonb_array_elements(r->'items') x where x->>'item_type' in ('media_added', 'video_added', 'milestone_achieved');
  results := results || format(E'%s still no photos, videos or milestones (%s found)\n', case when bad = 0 then 'PASS' else 'FAIL' end, bad);

  -- An admin-blocked player and one who switched "open to play" off leave the card.
  perform set_config('role', 'postgres', true);
  update profiles set is_blocked = true where id = p1;
  update profiles set open_to_play = false where id = p2;
  perform set_config('role', 'authenticated', true);
  r := get_home_feed_v2(50, 0, true);
  select count(*) into n from jsonb_array_elements(r->'items') x where x->>'item_type' = 'open_to_play_week';
  results := results || format(E'%s under 3 visible players the card is not shown (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);

  perform set_config('role', 'postgres', true);
  update profiles set is_blocked = false where id = p1;
  perform set_config('role', 'authenticated', true);
  r := get_home_feed_v2(50, 0, true);
  select x into card from jsonb_array_elements(r->'items') x where x->>'item_type' = 'open_to_play_week';
  select string_agg(m->>'id', ',') into ids from jsonb_array_elements(card->'members') m;
  results := results || format(E'%s a player no longer open to play is left out (member_count %s)\n',
    case when (card->>'member_count')::int = 3 and ids not like '%' || p2 || '%' then 'PASS' else 'FAIL' end, card->>'member_count');

  perform set_config('role', 'postgres', true);
  results := results || format(E'%s one get_home_feed_v2 function (%s)\n',
    case when (select count(*) from pg_proc where proname = 'get_home_feed_v2' and pronamespace = 'public'::regnamespace) = 1 then 'PASS' else 'FAIL' end,
    (select count(*) from pg_proc where proname = 'get_home_feed_v2' and pronamespace = 'public'::regnamespace));

  raise exception E'probe done, rolled back:\n%', results;
end $$;
