-- Probe for 20261109200000_spam_signal_short_greetings.sql (staging only; rolls itself back).
-- One sender opens 9 conversations; the first message of the first 8 is the short
-- greeting "Halo Honorable sir" (18 normalised characters), the 9th is "hi".
-- Expect: no signal after 7 people, a repeated_first_message signal with 8 people
-- after the 8th, and "hi" never hashed.
do $$
declare s uuid; r uuid; c uuid; i int := 0; after7 int; after8 int; hi_hash int;
begin
  select id into s from profiles where role='player' and onboarding_completed and not is_blocked order by created_at limit 1;
  for r in select id from profiles where id<>s and onboarding_completed and not is_blocked order by created_at desc limit 9 loop
    i := i + 1;
    insert into conversations(participant_one_id, participant_two_id) values (s, r) returning id into c;
    insert into new_conversation_log(user_id, other_user_id, conversation_id) values (s, r, c);
    perform set_config('request.jwt.claims', json_build_object('sub', s, 'role','authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into messages(conversation_id, sender_id, content) values (c, s, case when i = 9 then 'hi' else 'Halo Honorable sir' end);
    perform set_config('role', 'postgres', true);
    if i = 7 then select coalesce(max(people_count),0) into after7 from spam_signals where user_id=s and kind='repeated_first_message'; end if;
    if i = 8 then select coalesce(max(people_count),0) into after8 from spam_signals where user_id=s and kind='repeated_first_message'; end if;
  end loop;
  select count(*) into hi_hash from new_conversation_log where user_id=s and first_message_hash = md5('hi');
  raise notice '% no signal at 7 people (got %)', case when after7 = 0 then 'PASS' else 'FAIL' end, after7;
  raise notice '% signal at 8 people (got %)', case when after8 = 8 then 'PASS' else 'FAIL' end, after8;
  raise notice '% "hi" not compared (got %)', case when hi_hash = 0 then 'PASS' else 'FAIL' end, hi_hash;
  raise exception 'probe done, rolled back: after7=% after8=% hi_hashed=%', after7, after8, hi_hash;
end $$;
