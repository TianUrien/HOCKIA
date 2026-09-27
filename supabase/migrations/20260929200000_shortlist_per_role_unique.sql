-- =========================================================================
-- Shortlist per role: a player may sit on several of a club's shortlists
-- =========================================================================
-- Founder ruling (leaf 6 approval, 2026-09-27): shortlists are per role and
-- the same player may be on several roles' lists at once.
--
-- Live state (staging, inspected 2026-09-27):
--   saved_profiles_unique_pair             UNIQUE (owner_id, saved_profile_id)   ← one list per player per owner
--   saved_profiles_shortlist_player_unique UNIQUE (shortlist_id, saved_profile_id) ← already present (20260528100000)
--   shortlist_id is NOT NULL; no SQL function, trigger or client upsert
--   (onConflict) depends on the owner+player key.
--
-- Changes:
--   1. Drop the owner+player unique. Per-list uniqueness stays.
--   2. Partial unique index for rows without a list (shortlist_id IS NULL):
--      the old one-per-owner rule keeps holding for them if the column is
--      ever relaxed back to NULLable. No row matches today.
--   3. A row's list must belong to the row's owner (trigger). RLS already
--      pins owner_id = auth.uid(); this stops pointing a row at another
--      club's list id.
-- =========================================================================

ALTER TABLE public.saved_profiles
  DROP CONSTRAINT IF EXISTS saved_profiles_unique_pair;

CREATE UNIQUE INDEX IF NOT EXISTS saved_profiles_owner_player_no_list
  ON public.saved_profiles (owner_id, saved_profile_id)
  WHERE shortlist_id IS NULL;

-- Lookup "which lists is this player on" for one owner (the dropped unique
-- index served owner+player reads until now).
CREATE INDEX IF NOT EXISTS saved_profiles_owner_player_idx
  ON public.saved_profiles (owner_id, saved_profile_id);

CREATE OR REPLACE FUNCTION public.saved_profiles_list_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shortlist_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shortlists s
     WHERE s.id = NEW.shortlist_id AND s.owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'shortlist does not belong to this owner' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.saved_profiles_list_owner_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.saved_profiles_list_owner_guard() FROM anon;
REVOKE ALL ON FUNCTION public.saved_profiles_list_owner_guard() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.saved_profiles_list_owner_guard() TO service_role;

DROP TRIGGER IF EXISTS saved_profiles_list_owner_guard ON public.saved_profiles;
CREATE TRIGGER saved_profiles_list_owner_guard
  BEFORE INSERT OR UPDATE OF shortlist_id, owner_id ON public.saved_profiles
  FOR EACH ROW EXECUTE FUNCTION public.saved_profiles_list_owner_guard();
