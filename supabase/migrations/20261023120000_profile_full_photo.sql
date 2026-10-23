-- Full-shape profile photo (founder go-ahead 2026-10-23: plan, show before applying).
--
-- Why: the Community member deck shows the profile photo full screen on
-- phones (~1179 × 2556 px). avatar_url is a square (for the round avatars);
-- cropped to a tall screen it loses its sides and is stretched. This adds the
-- same photo in its own shape, kept up to 2048 px, for full-screen use only.
--
-- 1. profiles.avatar_full_url (nullable). NULL = no full-shape photo (every
--    existing profile, and uploads from clients that predate this): the
--    client falls back to avatar_url, so nothing changes for them.
-- 2. Column grants mirror avatar_url's (profiles uses column-level grants
--    since 20260707180000): SELECT to anon + authenticated, INSERT/UPDATE to
--    authenticated. Row access is still RLS, so hidden profiles (blocked or
--    frozen minors) stay hidden exactly as their avatar_url does.
-- 3. Trigger: when avatar_url changes and the same UPDATE does not set
--    avatar_full_url, the old full photo is cleared. Old native builds,
--    crest edits and any other writer that only knows avatar_url can never
--    leave a stale full photo of a previous picture.
--
-- Not breaking: one nullable column, no RPC or view changes; older clients
-- never read it.
--
-- Rollback: supabase/rollbacks/20261023120000_profile_full_photo.down.sql

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_full_url text;

COMMENT ON COLUMN public.profiles.avatar_full_url IS
  'The profile photo in its own shape (up to 2048 px) for full-screen views. NULL = use avatar_url. Cleared automatically when avatar_url changes without it.';

GRANT SELECT (avatar_full_url) ON public.profiles TO anon, authenticated;
GRANT INSERT (avatar_full_url), UPDATE (avatar_full_url) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_stale_avatar_full_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
     AND NEW.avatar_full_url IS NOT DISTINCT FROM OLD.avatar_full_url THEN
    NEW.avatar_full_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_stale_avatar_full_url() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clear_stale_avatar_full_url ON public.profiles;
CREATE TRIGGER trg_clear_stale_avatar_full_url
  BEFORE UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_stale_avatar_full_url();
