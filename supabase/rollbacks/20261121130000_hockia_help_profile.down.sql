-- Rollback for 20261121130000_hockia_help_profile.sql: restores the
-- conversation limit trigger body from 20261004300000_new_conversation_limits.sql
-- (a help chat counts again) and removes the help account functions and
-- setting. Clients treat a missing function as "no help account" and hide the
-- line.

CREATE OR REPLACE FUNCTION public._enforce_new_conversation_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_other uuid;
  v_limit integer;
  v_used  integer;
  v_known boolean;
  v_now   timestamptz := now();
BEGIN
  IF v_uid IS NULL
     OR v_uid NOT IN (NEW.participant_one_id, NEW.participant_two_id)
     OR NEW.participant_one_id = NEW.participant_two_id THEN
    RETURN NULL;
  END IF;
  IF public.is_platform_admin() THEN
    RETURN NULL;
  END IF;

  v_limit := public._new_conversation_daily_limit(v_uid);
  IF v_limit IS NULL THEN
    RETURN NULL;
  END IF;

  v_other := CASE WHEN NEW.participant_one_id = v_uid THEN NEW.participant_two_id ELSE NEW.participant_one_id END;

  PERFORM pg_advisory_xact_lock(hashtext('new_conversation:' || v_uid::text));

  SELECT count(DISTINCT l.other_user_id), coalesce(bool_or(l.other_user_id = v_other), false)
    INTO v_used, v_known
    FROM public.new_conversation_log l
   WHERE l.user_id = v_uid
     AND l.created_at > v_now - interval '24 hours';

  IF NOT v_known AND v_used >= v_limit THEN
    RAISE EXCEPTION 'You''ve started a lot of new conversations today. You can start more tomorrow.'
      USING DETAIL = 'new_conversation_limit', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.new_conversation_log (user_id, other_user_id, conversation_id, created_at)
  VALUES (v_uid, v_other, NEW.id, v_now);

  IF NOT v_known AND v_used + 1 >= v_limit THEN
    INSERT INTO public.spam_signals AS s (user_id, kind, signal_key, people_count, first_seen_at, last_seen_at)
    VALUES (v_uid, 'daily_limit', to_char(v_now AT TIME ZONE 'utc', 'YYYY-MM-DD'), v_used + 1, v_now, v_now)
    ON CONFLICT ON CONSTRAINT spam_signals_user_kind_key_unique DO UPDATE
      SET people_count = greatest(s.people_count, excluded.people_count),
          last_seen_at = excluded.last_seen_at;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._enforce_new_conversation_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enforce_new_conversation_limit() TO service_role;

DROP FUNCTION IF EXISTS public.hockia_help_profile_id();
DROP FUNCTION IF EXISTS public._hockia_help_account();
DELETE FROM public.app_settings WHERE key = 'hockia_help_profile_id';
NOTIFY pgrst, 'reload schema';
