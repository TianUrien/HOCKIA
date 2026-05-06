-- Delete test accounts from production.
-- These accounts should only exist in staging.
--
-- Strategy: manually clean up non-cascading references first,
-- then delete from auth.users which cascades to profiles and
-- all 28 tables with ON DELETE CASCADE.

DO $$
DECLARE
  v_email TEXT;
  v_user_id UUID;
  v_emails TEXT[] := ARRAY[
    'playrplayer93@gmail.com',
    'clubplayr8@gmail.com',
    'coachplayr@gmail.com',
    'brandplayr@gmail.com'
  ];
BEGIN
  FOREACH v_email IN ARRAY v_emails
  LOOP
    SELECT id INTO v_user_id FROM public.profiles WHERE email = v_email;

    IF v_user_id IS NULL THEN
      RAISE NOTICE 'No profile found for % — skipping', v_email;
      CONTINUE;
    END IF;

    RAISE NOTICE 'Deleting account: % (id: %)', v_email, v_user_id;

    -- 1. Clean up archived_messages (no FK cascade)
    DELETE FROM public.archived_messages
    WHERE sender_id = v_user_id
       OR conversation_id IN (
         SELECT id FROM public.conversations
         WHERE participant_one_id = v_user_id OR participant_two_id = v_user_id
       );

    -- 2. Clean up messages (FK cascades from conversations, but explicit is safer)
    DELETE FROM public.messages
    WHERE conversation_id IN (
      SELECT id FROM public.conversations
      WHERE participant_one_id = v_user_id OR participant_two_id = v_user_id
    );

    -- 3. Clean up conversations
    DELETE FROM public.conversations
    WHERE participant_one_id = v_user_id OR participant_two_id = v_user_id;

    -- 4. Clean up notifications where this user is the actor (SET NULL FK)
    UPDATE public.profile_notifications
    SET actor_profile_id = NULL
    WHERE actor_profile_id = v_user_id;

    -- 5. Delete the auth user — cascades to profiles → all CASCADE tables
    DELETE FROM auth.users WHERE id = v_user_id;

    RAISE NOTICE 'Deleted account: %', v_email;
  END LOOP;
END;
$$;
