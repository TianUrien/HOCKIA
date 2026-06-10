/**
 * Public profile SELECT lists.
 *
 * Defined here (not in the .tsx page files) so they can be imported by both
 * the page components and a regression test without violating the
 * react-refresh rule that .tsx files only export components.
 *
 * The Profile Snapshot reads several columns whose absence silently kills
 * the public ✓s (last_active_at, accepted_reference_count,
 * career_entry_count). The regression test in
 * `__tests__/publicProfileSnapshotFields.test.ts` asserts every snapshot
 * source column stays in these lists.
 */

export const PUBLIC_PROFILE_FIELDS_LIST = [
  'id',
  'role',
  'username',
  'full_name',
  'avatar_url',
  'base_location',
  'bio',
  'highlight_video_url',
  'highlight_visibility',
  'nationality',
  'nationality_country_id',
  'nationality2_country_id',
  // Increment #2.2 — residence drives the Interested-lens "home country"
  // ("staying in my country"); keeps the grid + ScoutingCard consistent.
  'base_country_id',
  'current_club',
  'current_world_club_id',
  'gender',
  'playing_category',
  'coaching_categories',
  'date_of_birth',
  'position',
  'secondary_position',
  // Matching Increment #3 — player specialist tags (shown on profile +
  // recruiter ScoutingCard).
  'specialist_skills',
  // contact_email is REVOKED from anon (migration 20260610100000). Select the
  // masked generated column (NULL unless contact_email_public) aliased back to
  // `contact_email`, so display + the "has contact" snapshot signal honour
  // consent for both anon and authenticated viewers of a public profile.
  'contact_email:contact_email_masked',
  'contact_email_public',
  'social_links',
  'is_test_account',
  'open_to_play',
  'open_to_coach',
  'coach_specialization',
  'coach_specialization_custom',
  'is_verified',
  'verified_at',
  // ProfileSnapshot reads these to compute the public ✓ list. Without them,
  // a player with references / career entries / recent activity would show
  // none of those signals to visitors — silently neutering the snapshot.
  'last_active_at',
  'accepted_reference_count',
  'career_entry_count',
  // LastActivePill reads show_last_active to honour the per-user opt-out.
  // Without this in the select, the pill falls through to its
  // graceful-default-show path and the toggle is purely cosmetic — no
  // visitor-side effect (caught in staging QA on Batch 8).
  'show_last_active',
  // Bento Grid visitor cards read these denormalized counts. Missing
  // them silently shows 0 on the public profile while the same counts
  // render correctly on the owner dashboard — caught in PR1 QA when
  // visitor Hero Friends tile showed 0 while ?tab=friends showed 1.
  'accepted_friend_count',
  'post_count',
  'full_game_video_count',
  // Matching Increment #2 — candidate intent shown read-only on the
  // public profile (the "Interested" preferences they chose to share).
  'relocation_willingness',
  'relocation_countries_open',
  'relocation_countries_excluded',
  'level_target',
  'opportunity_preference',
  'available_from',
  'availability_duration',
] as const

export const PUBLIC_PROFILE_FIELDS = PUBLIC_PROFILE_FIELDS_LIST.join(',')

export const PUBLIC_CLUB_FIELDS_LIST = [
  'id',
  'role',
  'username',
  'full_name',
  'avatar_url',
  'base_location',
  'nationality',
  'nationality_country_id',
  'club_bio',
  'club_history',
  'website',
  'year_founded',
  'womens_league_division',
  'mens_league_division',
  // Masked (see PUBLIC_PROFILE_FIELDS_LIST comment + migration 20260610100000).
  'contact_email:contact_email_masked',
  'contact_email_public',
  'social_links',
  'is_test_account',
  'is_verified',
  'verified_at',
  // ProfileSnapshot reads last_active_at for the "Active recently" public ✓.
  'last_active_at',
  // For when LastActivePill ships on Club profile headers (queued for a
  // later batch). Including it now keeps the field lists consistent and
  // means the per-user opt-out works the moment the pill mounts.
  'show_last_active',
] as const

export const PUBLIC_CLUB_FIELDS = PUBLIC_CLUB_FIELDS_LIST.join(',')

export const PUBLIC_UMPIRE_FIELDS_LIST = [
  'id',
  'role',
  'username',
  'full_name',
  'avatar_url',
  'base_location',
  'bio',
  'nationality',
  'nationality_country_id',
  'nationality2_country_id',
  'gender',
  'umpiring_categories',
  'date_of_birth',
  'social_links',
  'is_test_account',
  'is_verified',
  'verified_at',
  'umpire_level',
  'federation',
  'umpire_since',
  'officiating_specialization',
  'languages',
  'last_officiated_at',
  'umpire_appointment_count',
  'accepted_reference_count',
  // LastActivePill / Snapshot read these. last_active_at + show_last_active
  // both required for the per-user opt-out to work on umpire profiles.
  'last_active_at',
  'show_last_active',
] as const

export const PUBLIC_UMPIRE_FIELDS = PUBLIC_UMPIRE_FIELDS_LIST.join(',')
