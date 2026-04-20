/**
 * profileTier.ts
 *
 * Pure per-role profile-tier mapping. Four tiers in ascending order of
 * completeness — Rookie → Active → Rising → Elite — assigned from a
 * profile-strength percentage. Used by:
 *
 * - Profile headers (PlayerDashboard, CoachDashboard, ClubDashboard,
 *   BrandDashboard): pass the real `percentage` from the per-role strength
 *   hook directly to `calculateTier()`.
 * - Community grid (MemberCard via PeopleListView): per-card strength hooks
 *   would fire N queries for gallery counts, so `getMemberTier()` estimates
 *   the strength from the fields already fetched on the profile/brand row.
 *
 * Verified-style trust badges are intentionally a separate, admin-granted
 * concept — not one of these tiers.
 */
import type { CommunityMemberFields } from './profileCompletion'

export type ProfileTier = 'rookie' | 'active' | 'rising' | 'elite'

/** Lower bound of each tier, as % of profile strength (0–100). */
export const TIER_THRESHOLDS: Record<ProfileTier, number> = {
  rookie: 0,
  active: 40,
  rising: 70,
  elite: 90,
}

/** Map a profile-strength percentage to a tier. Values outside 0–100 are clamped. */
export function calculateTier(percentage: number): ProfileTier {
  const pct = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0
  if (pct >= TIER_THRESHOLDS.elite) return 'elite'
  if (pct >= TIER_THRESHOLDS.rising) return 'rising'
  if (pct >= TIER_THRESHOLDS.active) return 'active'
  return 'rookie'
}

const hasText = (value?: string | null): boolean => Boolean(value?.trim())
const hasNationality = (m: CommunityMemberFields): boolean =>
  Boolean(m.nationality_country_id || m.nationality?.trim())

/**
 * Estimate profile-strength % from the fields the community query already
 * fetches. Mirrors each role's strength hook but omits gallery (not
 * denormalized on the profile/brand row). The remaining bucket weights are
 * rescaled to sum to 100, so "all community-visible buckets filled" reads as
 * 100% — avoiding the case where an otherwise-complete profile never reaches
 * Elite just because gallery isn't fetched here.
 */
export function estimateMemberStrength(m: CommunityMemberFields): number {
  switch (m.role) {
    case 'player': {
      // Buckets from useProfileStrength (minus media-gallery @ weight 10):
      //   basic-info 15 · profile-photo 15 · highlight-video 20 · journey 15
      //   · friends 10 · references 15  → total 90, rescaled to 100
      const total = 15 + 15 + 20 + 15 + 10 + 15
      let score = 0
      if (hasNationality(m) && hasText(m.base_location) && hasText(m.position)) score += 15
      if (hasText(m.avatar_url)) score += 15
      if (hasText(m.highlight_video_url)) score += 20
      if ((m.career_entry_count ?? 0) >= 1) score += 15
      if ((m.accepted_friend_count ?? 0) >= 1) score += 10
      if ((m.accepted_reference_count ?? 0) >= 1) score += 15
      return Math.round((score / total) * 100)
    }
    case 'coach': {
      // Buckets from useCoachProfileStrength minus media-gallery.
      // Weights: basic-info 15 · specialization 10 · profile-photo 15 ·
      //   professional-bio 20 · journey 20 · references 10 → total 90
      const total = 15 + 10 + 15 + 20 + 20 + 10
      let score = 0
      if (hasText(m.full_name) && hasNationality(m) && hasText(m.base_location)) score += 15
      if (hasText(m.coach_specialization)) score += 10
      if (hasText(m.avatar_url)) score += 15
      if (hasText(m.bio)) score += 20
      if ((m.career_entry_count ?? 0) >= 1) score += 20
      if ((m.accepted_reference_count ?? 0) >= 1) score += 10
      return Math.round((score / total) * 100)
    }
    case 'club': {
      // Buckets from useClubProfileStrength minus photo-gallery (weight 20).
      // Weights: basic-info 35 · logo 25 · club-bio 20 → total 80
      const total = 35 + 25 + 20
      let score = 0
      const hasBasic =
        hasNationality(m) &&
        hasText(m.base_location) &&
        Boolean(m.year_founded) &&
        (hasText(m.website) || hasText(m.contact_email))
      if (hasBasic) score += 35
      if (hasText(m.avatar_url)) score += 25
      if (hasText(m.club_bio)) score += 20
      return Math.round((score / total) * 100)
    }
    case 'brand': {
      // Buckets from useBrandProfileStrength minus products & ambassadors
      // (both require extra queries).
      // Weights: identity 25 · about 20 · contact 15 · location 10 → total 70
      const total = 25 + 20 + 15 + 10
      let score = 0
      const hasIdentity =
        hasText(m.full_name) && hasText(m.avatar_url) && hasText(m.brand_category)
      const bio = m.brand_bio?.trim() ?? ''
      const hasAbout = bio.length >= 50
      const hasContact = hasText(m.brand_website_url) || hasText(m.brand_instagram_url)
      if (hasIdentity) score += 25
      if (hasAbout) score += 20
      if (hasContact) score += 15
      if (hasNationality(m)) score += 10
      return Math.round((score / total) * 100)
    }
    default:
      return 0
  }
}

/** Convenience: estimate strength from community fields and map to a tier. */
export function getMemberTier(m: CommunityMemberFields): ProfileTier {
  return calculateTier(estimateMemberStrength(m))
}
