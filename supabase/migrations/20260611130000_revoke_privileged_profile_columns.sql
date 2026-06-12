-- ============================================================================
-- CRITICAL: lock privileged / system-managed profile columns from client writes
-- ============================================================================
-- The `authenticated` role had column-level UPDATE on profiles.is_verified,
-- verified_at, is_blocked, the denormalized count columns, etc., while RLS only
-- gates the ROW ("Users can update their own profile": auth.uid() = id). No
-- trigger guarded these columns (only `role` was protected). Confirmed
-- exploitable via a plain PostgREST PATCH on one's own profile — any signed-in
-- user could:
--   * self-grant the Verified badge (is_verified/verified_at) — fake the trust
--     signal recruiters rely on;
--   * un-ban themselves (is_blocked=false) — evade admin moderation;
--   * inflate accepted_reference_count / career_entry_count / accepted_friend_
--     count / post_count / full_game_video_count — directly manipulating the
--     Evidence checklist and Recruiter Match ranking the product is built on.
--
-- Fix: REVOKE UPDATE on these columns from anon + authenticated. Legitimate
-- writes are unaffected:
--   * verification/blocking go through SECURITY DEFINER admin RPCs
--     (admin_set_profile_verified / admin_block_user), guarded by
--     is_platform_admin();
--   * the counts, profile_completeness_pct, version, and search_vector are set
--     by TRIGGERS, which run in the trigger/definer context and are NOT subject
--     to the calling user's column-level grants;
--   * the client profile editors (EditProfileModal optimisticUpdate, useMyBrand,
--     create_profile_for_new_user) never write any of these columns.
-- `role` was already protected by prevent_role_change.

REVOKE UPDATE (
  is_verified, verified_at, verified_by,
  is_blocked, blocked_at, blocked_by, blocked_reason,
  is_test_account,
  accepted_reference_count, accepted_friend_count, career_entry_count,
  post_count, full_game_video_count, umpire_appointment_count,
  profile_completeness_pct, version, search_vector
) ON public.profiles FROM anon, authenticated;
