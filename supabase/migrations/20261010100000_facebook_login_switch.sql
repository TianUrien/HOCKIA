-- Remote switch for "Continue with Facebook" (founder ruling 2026-10-10).
--
-- The store apps bake their web bundle in, so a build-time flag would need a
-- new store build (and review) to turn Facebook sign-in on once Meta allows it
-- for everyone. Instead the button reads app_settings key
-- 'facebook_login_enabled' at runtime, same pattern as video_posts_enabled:
--   - absent row (every environment after this migration) -> OFF;
--   - flip ON with: INSERT INTO public.app_settings (key, value)
--     VALUES ('facebook_login_enabled', 'true')
--     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--   - flip OFF by deleting the row or setting any other value.
-- The web build can still force the button on with VITE_ENABLE_FACEBOOK_LOGIN
-- (staging uses it).
--
-- The sign-up and log-in screens are shown before any session exists, so anon
-- may call it. It returns one public boolean and reads nothing else.

CREATE OR REPLACE FUNCTION public.facebook_login_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_settings
    WHERE key = 'facebook_login_enabled' AND value = 'true'
  );
$function$;

REVOKE ALL ON FUNCTION public.facebook_login_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facebook_login_enabled() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.facebook_login_enabled IS
  'Runtime switch for the "Continue with Facebook" button (app_settings key facebook_login_enabled). Absent row = OFF. Public boolean; callable before sign-in.';
