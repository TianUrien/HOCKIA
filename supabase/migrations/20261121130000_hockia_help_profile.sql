-- Hockia help at failure and help moments (founder 2026-11-21,
-- docs/product/proposals/brand-promotion.md, phase 2). When something fails,
-- a search finds nothing, or a member opens Help, one line offers "Ask
-- Hockia" and opens a chat with the Hockia account. These moments are for
-- Hockia only; no other brand appears there.
--
-- Which account answers is a runtime setting, so it can be set per
-- environment and changed without a store build (same pattern as
-- facebook_login_enabled):
--   - absent row (every environment after this migration) -> NULL, and the
--     line is not shown anywhere;
--   - turn on with: INSERT INTO public.app_settings (key, value)
--     VALUES ('hockia_help_profile_id', '<profile uuid>')
--     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--   - turn off by deleting the row.
--
-- hockia_help_profile_id() answers "can THIS member open that chat right
-- now?", so the line is never shown when tapping it would be refused. It
-- returns the id only when:
--   - the value is a uuid (upper or lower case) of a profile that exists, has
--     finished onboarding and is not hidden or uncontactable;
--   - the caller is signed in, is not that account, has finished onboarding
--     and is not hidden or uncontactable (the same rule the message triggers
--     apply: enforce_conversation_not_blocked);
--   - neither side has blocked the other.
-- It returns one public profile id and nothing about why it is NULL.
--
-- The daily allowance of new conversations (20261004300000) does not apply
-- to this chat (founder 2026-11-21): a member who has used the day's
-- allowance, and a new member with 5 a day, can still ask for help.
-- _enforce_new_conversation_limit() is rewritten from its latest body with
-- one early return: a conversation the member starts with the help account
-- is neither refused nor logged. Everything else in the limit is unchanged,
-- including a conversation the help account itself starts.
-- Rollback: supabase/rollbacks/20261121130000_hockia_help_profile.down.sql
-- Probe: supabase/tests/security/hockia_help_profile.probe.sql (staging, rolled back)

-- The account named in the setting, whoever asks. Internal: used by the
-- function below and by the conversation limit trigger.
CREATE OR REPLACE FUNCTION public._hockia_help_account()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.value::uuid FROM public.app_settings s
   WHERE s.key = 'hockia_help_profile_id'
     AND s.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;

REVOKE ALL ON FUNCTION public._hockia_help_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._hockia_help_account() TO service_role;

CREATE OR REPLACE FUNCTION public.hockia_help_profile_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_help uuid := public._hockia_help_account();
BEGIN
  IF v_me IS NULL OR v_help IS NULL OR v_help = v_me THEN RETURN NULL; END IF;

  -- Both sides can take part in a conversation.
  IF (SELECT count(*) FROM public.profiles p
       WHERE p.id IN (v_help, v_me)
         AND coalesce(p.onboarding_completed, false)
         AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)) <> 2 THEN
    RETURN NULL;
  END IF;
  IF public.is_blocked_pair(v_me, v_help) THEN RETURN NULL; END IF;

  RETURN v_help;
END;
$function$;

REVOKE ALL ON FUNCTION public.hockia_help_profile_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hockia_help_profile_id() TO authenticated, service_role;

COMMENT ON FUNCTION public.hockia_help_profile_id IS
  'The profile that answers "Ask Hockia" (app_settings key hockia_help_profile_id), or NULL when there is none or the caller could not open a chat with it right now. Callers show the help line only on a non-null answer.';

-- The limit trigger, from its latest body (20261004300000) plus the early return.
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

  -- Asking Hockia for help is not one of the day's new conversations (founder
  -- 2026-11-21): it is neither refused at the limit nor counted toward it.
  -- Only a chat the member opens with the help account; a chat that account
  -- opens with a member is counted like any other.
  IF v_other = public._hockia_help_account() THEN
    RETURN NULL;
  END IF;

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

NOTIFY pgrst, 'reload schema';
