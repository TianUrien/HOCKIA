-- ROLLBACK for 20261010100000_facebook_login_switch.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261010100000 --linked
--
-- Drops facebook_login_enabled() (created by the migration; nothing existed
-- before it). Clients that call it then get an error and keep the Facebook
-- button hidden (useFacebookLoginEnabled treats any failure as OFF).
-- Data: an app_settings 'facebook_login_enabled' row, if one was added, is
-- removed too so a later re-apply starts OFF.

DROP FUNCTION IF EXISTS public.facebook_login_enabled();
DELETE FROM public.app_settings WHERE key = 'facebook_login_enabled';
