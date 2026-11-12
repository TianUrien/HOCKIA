-- Rollback for 20261111100000_auth_protection.sql
--
-- BEFORE applying: in the dashboard (Authentication > Hooks) make sure the
-- "Before User Created" hook is NOT pointing at hook_before_user_created,
-- or every sign-up fails once the function is gone.
--
-- Removes the measurement table, its key, the functions, the cron job and
-- the switch rows. Nothing else referenced them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_auth_attempts_daily') THEN
      PERFORM cron.unschedule('prune_auth_attempts_daily');
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.prune_auth_attempts();
DROP FUNCTION IF EXISTS public.admin_get_auth_attempts(integer);
DROP FUNCTION IF EXISTS public.hook_before_user_created(jsonb);
DROP FUNCTION IF EXISTS public.auth_guard_report(text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.auth_guard_check(text, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.auth_guard_switch(text);
DROP FUNCTION IF EXISTS public.auth_guard_setting_int(text, integer);
DROP FUNCTION IF EXISTS public.auth_guard_hash(text);

DROP TABLE IF EXISTS public.auth_attempts;
DROP TABLE IF EXISTS public.auth_guard_keys;

DELETE FROM public.app_settings
 WHERE key IN ('auth_rate_limit_enabled', 'auth_turnstile_enforced', 'auth_limit_device_max',
               'auth_limit_ip_max', 'auth_limit_window_seconds', 'auth_limit_signups_per_hour');
