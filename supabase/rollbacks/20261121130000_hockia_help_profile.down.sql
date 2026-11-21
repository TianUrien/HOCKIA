-- Rollback for 20261121130000_hockia_help_profile.sql. Clients treat a missing
-- function as "no help account" and hide the line.
DROP FUNCTION IF EXISTS public.hockia_help_profile_id();
DELETE FROM public.app_settings WHERE key = 'hockia_help_profile_id';
NOTIFY pgrst, 'reload schema';
