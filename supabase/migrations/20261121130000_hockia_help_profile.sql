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
-- The function returns the id only while that profile exists and is not
-- hidden, so a blocked or removed account never receives new chats. It
-- returns one public profile id and reads nothing else. Signed-in callers
-- only: a chat needs a session.
-- Rollback: supabase/rollbacks/20261121130000_hockia_help_profile.down.sql

CREATE OR REPLACE FUNCTION public.hockia_help_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id
    FROM public.app_settings s
    JOIN public.profiles p ON p.id::text = s.value
   WHERE s.key = 'hockia_help_profile_id'
     AND s.value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.hockia_help_profile_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hockia_help_profile_id() TO authenticated, service_role;

COMMENT ON FUNCTION public.hockia_help_profile_id IS
  'The profile that answers "Ask Hockia" (app_settings key hockia_help_profile_id). Absent row, or a hidden profile, = NULL and the help line is not shown.';

NOTIFY pgrst, 'reload schema';
