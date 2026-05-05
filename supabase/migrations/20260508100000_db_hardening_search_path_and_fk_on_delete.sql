-- =========================================================================
-- DB hardening — search_path on SECURITY DEFINER + ON DELETE on 5 FKs
-- =========================================================================
-- Two small batches from the production-readiness audit:
--
-- 1. get_club_members() is SECURITY DEFINER but has no SET search_path.
--    A user who could swap public on the search path could shadow the
--    referenced tables and have the function operate on tables they
--    control. ALTER FUNCTION ... SET adds the lock without redefining.
--
-- 2. Five FK columns reference parents but have no ON DELETE clause, so
--    the default RESTRICT applies. When the parent row is deleted, the
--    delete will error instead of cleanly cascading or nulling. SET NULL
--    is the right call here:
--      - country FK columns (nationality, nationality2, base): a country
--        could conceivably be re-keyed; preserve the profile by nulling
--        the reference rather than blocking the country delete
--      - profiles.blocked_by: the admin who blocked a user. If the admin
--        account is deleted, preserve the block but null the reviewer
--        attribution
--      - user_reports.reviewed_by: same shape, same fix
--
-- (The audit mentioned passport_country FKs, but those columns were
-- removed by 202602221000_remove_passport_fields.sql — so they're not
-- in scope here.)
--
-- Recreating an FK constraint with ALTER ... DROP/ADD takes a brief
-- ACCESS EXCLUSIVE lock. All five tables involved are small (profiles
-- ~few thousand rows, user_reports under 100, etc.) — well under a
-- second. No data is modified.
-- =========================================================================

-- 1. Lock get_club_members search_path
ALTER FUNCTION public.get_club_members(p_profile_id uuid, p_limit integer, p_offset integer)
  SET search_path = public;

-- 2. profiles.base_country_id → countries(id) ON DELETE SET NULL
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_base_country_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_base_country_id_fkey
  FOREIGN KEY (base_country_id)
  REFERENCES public.countries(id)
  ON DELETE SET NULL;

-- 3. profiles.nationality_country_id → countries(id) ON DELETE SET NULL
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_nationality_country_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_nationality_country_id_fkey
  FOREIGN KEY (nationality_country_id)
  REFERENCES public.countries(id)
  ON DELETE SET NULL;

-- 4. profiles.nationality2_country_id → countries(id) ON DELETE SET NULL
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_nationality2_country_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_nationality2_country_id_fkey
  FOREIGN KEY (nationality2_country_id)
  REFERENCES public.countries(id)
  ON DELETE SET NULL;

-- 5. profiles.blocked_by → auth.users(id) ON DELETE SET NULL
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_blocked_by_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_blocked_by_fkey
  FOREIGN KEY (blocked_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

-- 6. user_reports.reviewed_by → auth.users(id) ON DELETE SET NULL
ALTER TABLE public.user_reports
  DROP CONSTRAINT IF EXISTS user_reports_reviewed_by_fkey;
ALTER TABLE public.user_reports
  ADD CONSTRAINT user_reports_reviewed_by_fkey
  FOREIGN KEY (reviewed_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
