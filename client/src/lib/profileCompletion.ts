/**
 * profileCompletion.ts
 *
 * Cheap, per-role "is this profile fully complete?" predicates that run on
 * the subset of fields we already fetch in the community-grid query. Used
 * by MemberCard to render a positive "Profile complete" pill — profiles that
 * meet the threshold get visible recognition; incomplete profiles are
 * simply unmarked (no public score, no shaming).
 *
 * Kept intentionally close to each role's full profile-strength hook
 * (useProfileStrength, useCoachProfileStrength, useClubProfileStrength,
 * useBrandProfileStrength) but omits the gallery bucket — gallery counts
 * are not denormalized onto the profile/brand row, so including them would
 * require a per-card query. Gallery is ~10–20% of each role's weight, so
 * treating the remaining buckets as a proxy for "fully complete" is close
 * enough for this display — we can tighten the check once gallery counts
 * get denormalized.
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
}

const hasNationality = (m: CommunityMemberFields): boolean =>
  Boolean(m.nationality_country_id || m.nationality?.trim())

const hasText = (value?: string | null): boolean => Boolean(value?.trim())

/**
 * Player: basic info + photo + highlight video + journey + friends + references.
 * Gallery bucket is omitted (not cheaply available in the community query).
 * Matches useProfileStrength.ts buckets: basic-info, profile-photo,
 * highlight-video, journey, friends, references.
 */
function isPlayerComplete(m: CommunityMemberFields): boolean {
  const hasBasic = hasNationality(m) && hasText(m.base_location) && hasText(m.position)
  return (
    hasBasic &&
    hasText(m.avatar_url) &&
    hasText(m.highlight_video_url) &&
    (m.career_entry_count ?? 0) >= 1 &&
    (m.accepted_friend_count ?? 0) >= 1 &&
    (m.accepted_reference_count ?? 0) >= 1
  )
}

/**
 * Coach: basic info + specialization + photo + professional bio + journey + references.
 * Matches useCoachProfileStrength.ts buckets minus media gallery.
 * Note: the full coach hook also requires DOB/gender in the "basic" bucket — we
 * relax that here because the community query only fetches name/nationality/location.
 */
function isCoachComplete(m: CommunityMemberFields): boolean {
  const hasBasic = hasText(m.full_name) && hasNationality(m) && hasText(m.base_location)
  return (
    hasBasic &&
    hasText(m.coach_specialization) &&
    hasText(m.avatar_url) &&
    hasText(m.bio) &&
    (m.career_entry_count ?? 0) >= 1 &&
    (m.accepted_reference_count ?? 0) >= 1
  )
}

/**
 * Club: basic info + logo + bio.
 * Matches useClubProfileStrength.ts buckets minus photo gallery (club_media is
 * not denormalized).
 */
function isClubComplete(m: CommunityMemberFields): boolean {
  const hasBasic =
    hasNationality(m) &&
    hasText(m.base_location) &&
    Boolean(m.year_founded) &&
    (hasText(m.website) || hasText(m.contact_email))
  return hasBasic && hasText(m.avatar_url) && hasText(m.club_bio)
}

/**
 * Brand: identity (name, logo, category) + about (≥50 chars) + contact + location.
 * Matches useBrandProfileStrength.ts buckets minus products and ambassadors
 * (both require extra queries; ambassadors is optional for small brands).
 */
function isBrandComplete(m: CommunityMemberFields): boolean {
  const hasIdentity =
    hasText(m.full_name) && hasText(m.avatar_url) && hasText(m.brand_category)
  const bio = m.brand_bio?.trim() ?? ''
  const hasAbout = bio.length >= 50
  const hasContact = hasText(m.brand_website_url) || hasText(m.brand_instagram_url)
  const hasLocation = hasNationality(m)
  return hasIdentity && hasAbout && hasContact && hasLocation
}

/**
 * Umpire: credentials-first. Level + federation + specialization + photo
 * + bio + ≥ 1 language are the "complete" bar. Journey/Gallery are deferred
 * to Phase C, so they're not part of completeness yet.
 */
function isUmpireComplete(m: CommunityMemberFields): boolean {
  return (
    hasNationality(m) &&
    hasText(m.base_location) &&
    hasText(m.umpire_level) &&
    hasText(m.federation) &&
    hasText(m.officiating_specialization) &&
    hasText(m.avatar_url) &&
    hasText(m.bio) &&
    (m.languages?.length ?? 0) >= 1
  )
}

/**
 * Returns true when the member meets the per-role "fully complete" threshold
 * using only the fields cheaply fetched in the community grid query.
 */
export function isProfileComplete(m: CommunityMemberFields): boolean {
  switch (m.role) {
    case 'player':
      return isPlayerComplete(m)
    case 'coach':
      return isCoachComplete(m)
    case 'club':
      return isClubComplete(m)
    case 'brand':
      return isBrandComplete(m)
    case 'umpire':
      return isUmpireComplete(m)
    default:
      return false
  }
}
