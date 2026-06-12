-- ============================================================================
-- Restore anon SELECT on public-profile columns (fix logged-out 401)
-- ============================================================================
-- Bug (prod): logged-out visitors got "Profile Not Found" on every public
-- player/club/umpire profile. PostgREST returned 42501 "permission denied for
-- table profiles" because the public-profile SELECT (client/src/lib/
-- publicProfileFields.ts) requests columns the `anon` role was never granted.
-- anon has COLUMN-LEVEL grants on profiles, and these newer
-- Increment #2/#3 intent + denormalized-count + opt-out columns drifted out of
-- that grant list — so a single ungranted column 401s the WHOLE row for anon.
--
-- These are all PUBLIC_PROFILE_FIELDS columns — read-only intent/preference/
-- count fields the public profile displays BY DESIGN. No sensitive data is
-- exposed (raw contact_email stays revoked from anon — 20260610100300 — and is
-- only ever read masked via contact_email_masked). RLS still gates WHICH rows
-- anon can read; these grants are the outer column fence.
--
-- (club/umpire pages only needed show_last_active; the rest are player fields.)

GRANT SELECT (
  base_country_id,
  specialist_skills,
  show_last_active,
  accepted_friend_count,
  post_count,
  full_game_video_count,
  relocation_willingness,
  relocation_countries_open,
  relocation_countries_excluded,
  level_target,
  opportunity_preference,
  available_from,
  availability_duration
) ON public.profiles TO anon, authenticated;
