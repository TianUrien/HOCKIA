-- ============================================================================
-- profiles: replace table-level write grants with a column whitelist
-- ============================================================================
-- 20260611130000 attempted to lock the privileged / system-managed profile
-- columns with a column-level REVOKE — but anon/authenticated hold TABLE-level
-- write grants on public.profiles (relacl: anon=awdDxtm, authenticated=
-- arwdDxtm), and in Postgres a column-level REVOKE does not subtract from a
-- table-level grant. That migration was a no-op; the exploit it documented
-- stayed open on staging AND prod: any signed-in user could PATCH
-- is_verified / is_blocked / the denormalized evidence counts on their own
-- row, and could INSERT a forged row ("Users can insert their own profile"
-- RLS policy + table-level INSERT = forged counts/badge at insert time).
--
-- Real fix — whitelist, not blacklist:
--   * anon loses ALL write verbs. RLS has no anon write policy (and TRUNCATE
--     is not RLS-gated at all, only unreachable via PostgREST), so nothing
--     legitimate is affected.
--   * authenticated keeps INSERT/UPDATE only on the columns clients actually
--     write — every column EXCEPT the 17 privileged ones. DELETE/TRUNCATE/
--     REFERENCES/TRIGGER are revoked: no RLS DELETE policy exists; profile
--     deletion is service-role territory.
--   * id stays grantable (RLS WITH CHECK auth.uid() = id pins it); role
--     stays grantable (prevent_role_change trigger guards changes, and the
--     onboarding INSERT must set it). contact_email_masked is generated —
--     the grant is inert but keeps the list = "all minus privileged".
--   * Legitimate privileged writes are unaffected: admin verification/
--     blocking go through SECURITY DEFINER RPCs; the counts /
--     profile_completeness_pct / version / search_vector are trigger-
--     maintained (trigger context is not subject to the caller's column
--     grants).
--
-- NOTE for future migrations: a new client-editable profiles column must be
-- added to this GRANT explicitly or client writes to it will 42501 — same
-- drift hazard as the anon SELECT fence (see 20260611120000).

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles FROM authenticated;

GRANT
  INSERT (
    id, email, role, full_name, username, base_location, nationality,
    position, secondary_position, gender, date_of_birth, avatar_url,
    highlight_video_url, current_club, club_history, bio, club_bio,
    league_division, contact_email, website, year_founded,
    onboarding_completed, created_at, updated_at, contact_email_public,
    social_links, notify_opportunities, notify_applications,
    nationality_country_id, base_country_id, nationality2_country_id,
    open_to_play, open_to_coach, womens_league_division, mens_league_division,
    onboarding_started_at, onboarding_completed_at, open_to_opportunities,
    last_active_at, mens_league_id, womens_league_id, world_region_id,
    highlight_visibility, brand_representation, notify_friends,
    notify_references, notify_messages, last_message_email_at, notify_push,
    current_world_club_id, base_city, browse_anonymously,
    notify_profile_views, last_profile_view_email_at, last_platform,
    coach_specialization, coach_specialization_custom, umpire_level,
    federation, umpire_since, officiating_specialization, languages,
    last_officiated_at, playing_category, coaching_categories,
    umpiring_categories, category_confirmation_needed,
    coach_recruits_for_team, availability_confirmed_at,
    last_meaningful_update_at, last_check_in_prompt_at,
    last_profile_view_pulse_at, show_last_active, relocation_willingness,
    relocation_countries_open, relocation_countries_excluded, level_target,
    opportunity_preference, available_from, availability_duration,
    specialist_skills, contact_email_masked
  ),
  UPDATE (
    id, email, role, full_name, username, base_location, nationality,
    position, secondary_position, gender, date_of_birth, avatar_url,
    highlight_video_url, current_club, club_history, bio, club_bio,
    league_division, contact_email, website, year_founded,
    onboarding_completed, created_at, updated_at, contact_email_public,
    social_links, notify_opportunities, notify_applications,
    nationality_country_id, base_country_id, nationality2_country_id,
    open_to_play, open_to_coach, womens_league_division, mens_league_division,
    onboarding_started_at, onboarding_completed_at, open_to_opportunities,
    last_active_at, mens_league_id, womens_league_id, world_region_id,
    highlight_visibility, brand_representation, notify_friends,
    notify_references, notify_messages, last_message_email_at, notify_push,
    current_world_club_id, base_city, browse_anonymously,
    notify_profile_views, last_profile_view_email_at, last_platform,
    coach_specialization, coach_specialization_custom, umpire_level,
    federation, umpire_since, officiating_specialization, languages,
    last_officiated_at, playing_category, coaching_categories,
    umpiring_categories, category_confirmation_needed,
    coach_recruits_for_team, availability_confirmed_at,
    last_meaningful_update_at, last_check_in_prompt_at,
    last_profile_view_pulse_at, show_last_active, relocation_willingness,
    relocation_countries_open, relocation_countries_excluded, level_target,
    opportunity_preference, available_from, availability_duration,
    specialist_skills, contact_email_masked
  )
ON public.profiles TO authenticated;
