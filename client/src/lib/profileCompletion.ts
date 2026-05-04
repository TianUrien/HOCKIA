/**
 * profileCompletion.ts
 *
 * Shared `CommunityMemberFields` type used by the community-grid
 * `profileTier` calculations. Originally hosted per-role "is this profile
 * fully complete?" predicates intended to drive a "Profile complete" pill
 * on MemberCard, but that surface never shipped (MemberCard uses TierBadge
 * instead). The predicates were removed in the post-launch cleanup; the
 * type stayed because `profileTier.ts` consumes it.
 *
 * Field set is the cheap subset already fetched in the community-grid
 * query — anything that would require a separate query (e.g. media gallery
 * counts) is intentionally omitted.
 */

export interface CommunityMemberFields {
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  full_name?: string | null
  avatar_url?: string | null
  nationality?: string | null
  nationality_country_id?: number | null
  base_location?: string | null
  position?: string | null
  highlight_video_url?: string | null
  bio?: string | null
  club_bio?: string | null
  year_founded?: number | null
  website?: string | null
  contact_email?: string | null
  coach_specialization?: string | null
  career_entry_count?: number | null
  accepted_friend_count?: number | null
  accepted_reference_count?: number | null
  /** Brand-only fields fetched via the brands table join */
  brand_category?: string | null
  brand_bio?: string | null
  brand_website_url?: string | null
  brand_instagram_url?: string | null
  /** Umpire-only fields fetched directly from the profile row */
  umpire_level?: string | null
  federation?: string | null
  umpire_since?: number | null
  officiating_specialization?: string | null
  languages?: string[] | null
  umpire_appointment_count?: number | null
}
