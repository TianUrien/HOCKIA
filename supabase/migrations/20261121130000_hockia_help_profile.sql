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
--   - neither side has blocked the other;
--   - the caller already has a conversation with the account, or still has
--     room in the daily allowance of new conversations
--     (20261004300000_new_conversation_limits). A help chat counts toward
--     that allowance like any other conversation; nothing in the limit
--     changes here.
-- It returns one public profile id and nothing about why it is NULL.
-- Rollback: supabase/rollbacks/20261121130000_hockia_help_profile.down.sql
-- Probe: supabase/tests/security/hockia_help_profile.probe.sql (staging, rolled back)

CREATE OR REPLACE FUNCTION public.hockia_help_profile_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_value text;
  v_help uuid;
  v_limit integer;
  v_used integer;
  v_known boolean;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;

  SELECT s.value INTO v_value FROM public.app_settings s WHERE s.key = 'hockia_help_profile_id';
  IF v_value IS NULL OR v_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  v_help := v_value::uuid;
  IF v_help = v_me THEN RETURN NULL; END IF;

  -- Both sides can take part in a conversation.
  IF (SELECT count(*) FROM public.profiles p
       WHERE p.id IN (v_help, v_me)
         AND coalesce(p.onboarding_completed, false)
         AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)) <> 2 THEN
    RETURN NULL;
  END IF;
  IF public.is_blocked_pair(v_me, v_help) THEN RETURN NULL; END IF;

  -- An existing conversation can always be reopened.
  IF EXISTS (SELECT 1 FROM public.conversations c
              WHERE (c.participant_one_id = v_me AND c.participant_two_id = v_help)
                 OR (c.participant_one_id = v_help AND c.participant_two_id = v_me)) THEN
    RETURN v_help;
  END IF;

  -- A new one needs room in today's allowance (admins and test accounts have no limit).
  IF public.is_platform_admin() THEN RETURN v_help; END IF;
  v_limit := public._new_conversation_daily_limit(v_me);
  IF v_limit IS NULL THEN RETURN v_help; END IF;
  SELECT count(DISTINCT l.other_user_id), coalesce(bool_or(l.other_user_id = v_help), false)
    INTO v_used, v_known
    FROM public.new_conversation_log l
   WHERE l.user_id = v_me AND l.created_at > now() - interval '24 hours';
  IF NOT v_known AND v_used >= v_limit THEN RETURN NULL; END IF;

  RETURN v_help;
END;
$function$;

REVOKE ALL ON FUNCTION public.hockia_help_profile_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hockia_help_profile_id() TO authenticated, service_role;

COMMENT ON FUNCTION public.hockia_help_profile_id IS
  'The profile that answers "Ask Hockia" (app_settings key hockia_help_profile_id), or NULL when there is none or the caller could not open a chat with it right now. Callers show the help line only on a non-null answer.';

NOTIFY pgrst, 'reload schema';
