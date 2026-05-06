-- =========================================================================
-- Public profile share — RLS + column hardening for anonymous viewers
-- =========================================================================
-- Context: we are about to allow logged-out visitors to open
-- /players/:username, /coaches/:username, /clubs/:username,
-- /umpires/:username (brand was already public). The existing public
-- profile SELECT policy USES (onboarding_completed = TRUE) without
-- a TO clause, so it grants SELECT on ALL profile columns to anon —
-- including the auth `email` column, internal flags, and other private
-- fields. The frontend already requests only safe columns via
-- PUBLIC_PROFILE_FIELDS_LIST, but a determined actor in the JS console
-- could harvest emails. Before opening the routes, we tighten this.
--
-- Strategy: column-level GRANT + role-scoped policies.
--   * Authenticated users: behavior unchanged. They keep full SELECT
--     and the existing policy (now scoped TO authenticated explicitly)
--     so dashboards, AI Discovery, search, network, messages, admin,
--     onboarding all keep working exactly as before.
--   * Anon users: REVOKE blanket SELECT, GRANT only the specific safe
--     columns the public profile pages actually render. Row-level
--     filter also tightened: hides test accounts.
--
-- Soft-delete filter intentionally omitted: HOCKIA hard-deletes via
-- the delete-account edge function (no deleted_at column on profiles).
-- If we add soft-delete later, extend the anon policy with a
-- deleted_at IS NULL clause.
--
-- Idempotent: safe to re-run.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Replace the catch-all public SELECT policy with two role-scoped ones.
-- -------------------------------------------------------------------------
-- Drop the old policy that grants every onboarded row to PUBLIC (anon
-- + authenticated together), with no column restriction.
DROP POLICY IF EXISTS "Public can view onboarded profiles" ON public.profiles;

-- Authenticated viewers keep the broader access they have today
-- (needed for network/search/feed/cross-profile joins).
DROP POLICY IF EXISTS "Authenticated can view onboarded profiles" ON public.profiles;
CREATE POLICY "Authenticated can view onboarded profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (onboarding_completed = TRUE);

-- Anon viewers: tighter row filter (no test accounts).
DROP POLICY IF EXISTS "Anon can view active onboarded profiles" ON public.profiles;
CREATE POLICY "Anon can view active onboarded profiles"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (
    onboarding_completed = TRUE
    AND COALESCE(is_test_account, false) = false
  );

-- -------------------------------------------------------------------------
-- 2) Column-level GRANT for anon — strip blanket SELECT, allow only the
--    columns rendered by the public profile pages.
-- -------------------------------------------------------------------------
-- IMPORTANT: REVOKE the table-level SELECT first so anon falls back to
-- column-level grants. After this, any attempt by anon to SELECT a
-- column not in the GRANT list (e.g. `email`) returns
-- "permission denied for column email" — exactly what we want.
REVOKE SELECT ON public.profiles FROM anon;

-- Identity / display
GRANT SELECT (id, role, username, full_name, avatar_url, bio)
  ON public.profiles TO anon;

-- Location / nationality
GRANT SELECT (
  base_location,
  nationality,
  nationality_country_id,
  nationality2_country_id
) ON public.profiles TO anon;

-- Hockey-specific
GRANT SELECT (
  current_club,
  current_world_club_id,
  gender,
  date_of_birth,
  position,
  secondary_position,
  playing_category,
  coaching_categories,
  coach_specialization,
  coach_specialization_custom,
  open_to_play,
  open_to_coach,
  highlight_video_url,
  highlight_visibility
) ON public.profiles TO anon;

-- Public contact + socials (still gated in app layer by *_public flags)
GRANT SELECT (
  contact_email,
  contact_email_public,
  social_links
) ON public.profiles TO anon;

-- Trust / recruitment signals
GRANT SELECT (
  is_verified,
  verified_at,
  last_active_at,
  accepted_reference_count,
  career_entry_count
) ON public.profiles TO anon;

-- Club-specific public fields
GRANT SELECT (
  club_bio,
  club_history,
  website,
  year_founded,
  womens_league_division,
  mens_league_division
) ON public.profiles TO anon;

-- Umpire-specific public fields
GRANT SELECT (
  umpiring_categories,
  umpire_level,
  federation,
  umpire_since,
  officiating_specialization,
  languages,
  last_officiated_at,
  umpire_appointment_count
) ON public.profiles TO anon;

-- Required so the row-level filter can evaluate (USING clause needs
-- to read these values — granting them is safe; they aren't sensitive).
GRANT SELECT (onboarding_completed, is_test_account)
  ON public.profiles TO anon;

-- -------------------------------------------------------------------------
-- 3) Verification queries (run in psql to confirm; no-op as part of
-- migration). Documented here for reviewers / future debugging:
--
--   -- Should ERROR with "permission denied for column email":
--   SET ROLE anon;
--   SELECT email FROM public.profiles LIMIT 1;
--
--   -- Should succeed and return safe columns only:
--   SELECT id, username, full_name FROM public.profiles
--    WHERE onboarding_completed = TRUE LIMIT 1;
-- -------------------------------------------------------------------------

-- -------------------------------------------------------------------------
-- 4) Sanity comment so future migrations don't accidentally widen anon
-- access without thought.
-- -------------------------------------------------------------------------
COMMENT ON POLICY "Anon can view active onboarded profiles" ON public.profiles IS
  'Logged-out (anon) public profile view. PAIRED WITH a column-level GRANT '
  'that restricts which columns anon can read — see migration '
  '20260506040423_public_profile_share_hardening.sql. Do not widen this '
  'policy or add new GRANT (col) without checking what data is exposed '
  'externally (WhatsApp/email/LinkedIn share recipients).';
