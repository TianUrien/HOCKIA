-- Rollback for 20261023120000_profile_full_photo.sql.
-- Clients that read avatar_full_url fall back to avatar_url when it is
-- missing, but PostgREST select lists naming the column would 400: roll the
-- client back first (or make sure none names it) before running this.
-- Files in the avatars bucket (avatar_full_*.jpg) are left in place.

DROP TRIGGER IF EXISTS trg_clear_stale_avatar_full_url ON public.profiles;
DROP FUNCTION IF EXISTS public.clear_stale_avatar_full_url();
REVOKE SELECT (avatar_full_url) ON public.profiles FROM anon, authenticated;
REVOKE INSERT (avatar_full_url), UPDATE (avatar_full_url) ON public.profiles FROM authenticated;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_full_url;
