-- Probe for 20261110100000_messaging_per_user_state.sql (staging only; rolls itself back).
-- A and B talk; C is an outsider. Checks, as the members themselves:
--   delete for me hides one message for A only; mark unread lights the row and
--   the inbox dot; reading clears it; delete conversation hides it for A until B
--   writes again, and then A sees only the new message while B keeps everything;
--   C can call none of the RPCs and cannot write the state tables directly.
do $$
declare
  a uuid; b uuid; o uuid; c uuid; m1 uuid; m2 uuid;
  n int; u bigint; dot bigint; listed int; err text;
  procedure_ok boolean;
  results text := '';
begin
  select id into a from profiles where onboarding_completed and not is_blocked order by created_at limit 1;
  select id into b from profiles where onboarding_completed and not is_blocked and id <> a order by created_at desc limit 1;
  select id into o from profiles where onboarding_completed and not is_blocked and id not in (a, b) order by created_at limit 1 offset 1;
  insert into conversations(participant_one_id, participant_two_id) values (a, b) returning id into c;
  insert into messages(conversation_id, sender_id, content, sent_at) values (c, b, 'Probe one', now() - interval '2 minutes') returning id into m1;
  insert into messages(conversation_id, sender_id, content, sent_at) values (c, b, 'Probe two', now() - interval '2 minutes') returning id into m2;

  -- As A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform mark_conversation_messages_read(c, null);
  perform hide_message_for_me(m1);
  select count(*) into n from messages where conversation_id = c;
  results := results || format(E'%s delete for me hides 1 of 2 for A (sees %s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);

  perform set_conversation_marked_unread(c, true);
  select unread_count into u from get_user_conversations(a, 50, null, null) where conversation_id = c;
  select unread_count into dot from user_unread_counts_secure;
  results := results || format(E'%s marked unread shows on the row (unread_count %s) and the dot (%s)\n', case when u >= 1 and dot >= 1 then 'PASS' else 'FAIL' end, u, dot);

  perform mark_conversation_messages_read(c, null);
  select unread_count into u from get_user_conversations(a, 50, null, null) where conversation_id = c;
  results := results || format(E'%s reading clears the reminder (unread_count %s)\n', case when u = 0 then 'PASS' else 'FAIL' end, u);

  perform delete_conversation_for_me(c);
  select count(*) into listed from get_user_conversations(a, 50, null, null) where conversation_id = c;
  results := results || format(E'%s deleted conversation leaves A''s list (rows %s)\n', case when listed = 0 then 'PASS' else 'FAIL' end, listed);

  begin
    insert into conversation_user_state(conversation_id, user_id, cleared_at) values (c, a, null);
    err := 'none';
  exception when others then err := sqlstate;
  end;
  results := results || format(E'%s A cannot write the state table directly (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);

  -- B writes again (as B)
  perform set_config('role', 'postgres', true);
  -- now() is frozen inside one transaction: move the delete 1 s into the past
  -- so B's next message is "after" it, as it always is in real use.
  update conversation_user_state set cleared_at = cleared_at - interval '1 second'
   where conversation_id = c and user_id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into messages(conversation_id, sender_id, content) values (c, b, 'Probe three');
  select count(*) into n from messages where conversation_id = c;
  results := results || format(E'%s B still sees all 3 messages (sees %s)\n', case when n = 3 then 'PASS' else 'FAIL' end, n);

  -- Back to A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into listed from get_user_conversations(a, 50, null, null) where conversation_id = c;
  select count(*) into n from messages where conversation_id = c;
  results := results || format(E'%s conversation is back for A with only the new message (rows %s, messages %s)\n', case when listed = 1 and n = 1 then 'PASS' else 'FAIL' end, listed, n);

  -- Outsider C
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin perform set_conversation_marked_unread(c, true); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s outsider cannot mark unread (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  begin perform delete_conversation_for_me(c); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s outsider cannot delete the conversation (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);
  begin perform hide_message_for_me(m2); err := 'none'; exception when others then err := sqlstate; end;
  results := results || format(E'%s outsider cannot hide a message (%s)\n', case when err = '42501' then 'PASS' else 'FAIL' end, err);

  perform set_config('role', 'postgres', true);
  select has_function_privilege('anon', 'public.delete_conversation_for_me(uuid)', 'execute') into procedure_ok;
  results := results || format(E'%s anon cannot execute the RPCs (%s)\n', case when not procedure_ok then 'PASS' else 'FAIL' end, procedure_ok);

  raise exception E'probe done, rolled back:\n%', results;
end $$;
