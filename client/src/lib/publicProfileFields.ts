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
  'current_club',
  'current_world_club_id',
  'gender',
  'playing_category',
  'coaching_categories',
  'date_of_birth',
  'position',
  'secondary_position',
  'contact_email',
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
  'contact_email',
  'contact_email_public',
  'social_links',
  'is_test_account',
  'is_verified',
  'verified_at',
  // ProfileSnapshot reads last_active_at for the "Active recently" public ✓.
  'last_active_at',
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
] as const

export const PUBLIC_UMPIRE_FIELDS = PUBLIC_UMPIRE_FIELDS_LIST.join(',')
