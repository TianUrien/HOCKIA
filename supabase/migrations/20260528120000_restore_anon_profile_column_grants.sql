-- ─────────────────────────────────────────────────────────────────────
-- restore_anon_profile_column_grants — fix for 20260528110000
-- ─────────────────────────────────────────────────────────────────────
-- The previous Data API GRANTs audit migration
-- (20260528110000_explicit_data_api_grants.sql) did:
--
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
--   ...
--   REVOKE SELECT ON TABLE public.profiles FROM anon;
--
-- The intent was: schema-wide grant gives anon table-level SELECT on
-- profiles (which we don't want — public profile reads must go
-- through safe-column allow-listing); revoke it back.
--
-- The bug: Postgres's `REVOKE SELECT ON TABLE` removes BOTH the
-- table-level SELECT AND any column-level SELECTs previously granted.
-- The column-level safe-column allow list from migration
-- 20260506040423_public_profile_share_hardening.sql got wiped along
-- with the table-level grant, leaving anon with zero SELECT on
-- profiles. CI's rls.test.ts caught it ("anon CAN read safe columns
-- (no permission-denied error)" — now failing with 42501).
--
-- This migration restores the original safe-column allow list,
-- recreating the contract that public profile share pages depend on
-- for logged-out viewers (/players/:username, /coaches/:username,
-- /clubs/:username, /umpires/:username, brand pages).
--
-- The column list is COPIED VERBATIM from migration 20260506040423.
-- If new safe columns ever need to be exposed to anon, add them in a
-- new migration AND update the original 20260506040423 docs so the
-- canonical list stays discoverable.
--
-- Sequences/columns added since 20260506040423 that anon should NOT
-- see (email, internal flags, soft-delete bookkeeping, etc.) stay
-- correctly hidden — we only restore the original allow list.

BEGIN;

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

COMMIT;
