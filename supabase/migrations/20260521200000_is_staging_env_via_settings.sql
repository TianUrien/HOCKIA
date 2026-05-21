-- Make is_staging_env() caller-independent.
--
-- The previous definition (migration 20260521190000) read the request
-- JWT issuer. That works for logged-in users, but NOT for service-role
-- callers — notably the nl-search edge function, which calls
-- discover_profiles with a service-role client. So Hockia AI never saw
-- test accounts on staging even though every other surface did.
--
-- Replace the signal with a row in app_settings: caller-independent, so
-- it resolves identically for user, service-role and edge-function
-- requests. The 'environment' row is inserted ONLY on staging (out of
-- band — not in this migration), so on production the table is empty and
-- is_staging_env() is always false. This migration is a prod no-op.
--
-- Anonymous traffic is still excluded (auth.role() = 'anon'), so
-- logged-out / SEO visitors never see test accounts in either
-- environment — matching the untouched `Anon` RLS policy on profiles.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- RLS on with no policy: app_settings is an internal environment marker,
-- not user data. It is read solely by is_staging_env() (SECURITY
-- DEFINER, which bypasses RLS) and never exposed through the API.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_staging_env()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_settings
    WHERE key = 'environment' AND value = 'staging'
  )
  AND COALESCE(auth.role(), '') <> 'anon';
$function$;
