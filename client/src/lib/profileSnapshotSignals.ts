/**
 * profileSnapshotSignals.ts
 *
 * Pure signal-computation logic for the Profile Snapshot card. Extracted
 * from ProfileSnapshot.tsx so the component file only exports React
 * components (Vite + react-refresh constraint: a TSX file with non-component
 * named exports breaks fast refresh).
 *
 * The Snapshot is the v5-plan Clarity-Layer artifact for every role: a
 * concrete signal list (✓ for present, – for missing) — never a score and
 * never a quality judgment. Signals reflect what's visible on the profile
 * today, role by role.
 */
import type { Profile } from '@/lib/supabase'

export interface ProfileSnapshotSignal {
  /** Stable id for analytics + as a React key. */
  id: string
  /** Short human label (5–25 chars typically). */
  label: string
  /** Optional one-line detail (count, recency, etc.) shown to right of label when present. */
  detail?: string
  /** True when this signal is on the profile right now. */
  present: boolean
  /** Owner-mode action id to emit when an owner taps a missing signal. */
  ownerActionId?: string
}

export type ProfileSnapshotMode = 'owner' | 'public'

/** Subset of brand fields the snapshot needs. Brand-specific data lives on
 *  the brands table (not profiles), so we pass it in explicitly rather
 *  than synthesizing a profile-shaped object. Required when profile.role
 *  === 'brand'; ignored for other roles. */
export interface ProfileSnapshotBrandFields {
  logo_url: string | null
  bio: string | null
  website_url: string | null
  instagram_url: string | null
}

const ACTIVITY_RECENT_DAYS = 30
const AVAILABILITY_DECAY_DAYS = 60

function isRecentlyActive(lastActiveAt: string | null | undefined): boolean {
  if (!lastActiveAt) return false
  const ms = Date.now() - new Date(lastActiveAt).getTime()
  return ms <= ACTIVITY_RECENT_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Loop-Layer L2 — availability decay.
 *
 * The "Open to play" / "Open to coach" Snapshot signal used to be a pure
 * boolean read of profiles.open_to_*. With the weekly check-in landed,
 * the signal now also requires a recent confirmation: the user must have
 * tapped "Yes, still open" within the last 60 days for the chip to show.
 *
 * For profiles whose availability_confirmed_at has never been set
 * (existing accounts before the check-in shipped), we treat the boolean
 * alone as sufficient — no retroactive decay. Decay only applies once
 * the user has confirmed at least once and then let it lapse.
 */
function isAvailabilityFresh(
  isOpen: boolean,
  availabilityConfirmedAt: string | null | undefined,
): boolean {
  if (!isOpen) return false
  // Never confirmed → treat the boolean as authoritative (legacy users).
  if (!availabilityConfirmedAt) return true
  const ms = Date.now() - new Date(availabilityConfirmedAt).getTime()
  return ms <= AVAILABILITY_DECAY_DAYS * 24 * 60 * 60 * 1000
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0)
}

function hasNationality(p: Profile): boolean {
  return Boolean(p.nationality_country_id) || hasText(p.nationality)
}

function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

// ============================================================================
// Per-role signal computation
// ============================================================================

function computePlayerSignals(p: Profile): ProfileSnapshotSignal[] {
  const refCount = p.accepted_reference_count ?? 0
  const careerCount = p.career_entry_count ?? 0
  const availability = isAvailabilityFresh(
    Boolean(p.open_to_play) || Boolean(p.open_to_opportunities),
    p.availability_confirmed_at,
  )
  return [
    {
      id: 'photo',
      label: 'Photo',
      present: hasText(p.avatar_url),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'position',
      label: 'Position & category',
      present: hasText(p.position) && hasText(p.playing_category),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'club',
      label: 'Verified current club',
      present: Boolean(p.current_world_club_id),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'references',
      label: 'References',
      present: refCount > 0,
      detail: refCount > 0 ? pluralize(refCount, 'reference') : undefined,
      ownerActionId: 'tab:friends',
    },
    {
      id: 'video',
      label: 'Highlight video',
      present: hasText(p.highlight_video_url),
      ownerActionId: 'add-video',
    },
    {
      id: 'journey',
      label: 'Career journey',
      present: careerCount > 0,
      detail: careerCount > 0 ? pluralize(careerCount, 'entry', 'entries') : undefined,
      ownerActionId: 'tab:journey',
    },
    {
      id: 'availability',
      label: 'Open to play',
      present: availability,
      ownerActionId: 'edit-profile',
    },
    {
      id: 'activity',
      label: 'Active recently',
      present: isRecentlyActive(p.last_active_at),
      // Activity is a derived signal — no direct edit action.
    },
  ]
}

function computeCoachSignals(p: Profile): ProfileSnapshotSignal[] {
  const refCount = p.accepted_reference_count ?? 0
  const careerCount = p.career_entry_count ?? 0
  const hasCategories = Array.isArray(p.coaching_categories) && p.coaching_categories.length > 0
  const availability = isAvailabilityFresh(
    Boolean(p.open_to_coach) || Boolean(p.open_to_opportunities),
    p.availability_confirmed_at,
  )
  return [
    {
      id: 'photo',
      label: 'Photo',
      present: hasText(p.avatar_url),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'specialization',
      label: 'Specialization',
      present: hasText(p.coach_specialization),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'categories',
      label: 'Coaching categories',
      present: hasCategories,
      ownerActionId: 'edit-profile',
    },
    {
      id: 'bio',
      label: 'Bio',
      present: hasText(p.bio),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'journey',
      label: 'Career journey',
      present: careerCount > 0,
      detail: careerCount > 0 ? pluralize(careerCount, 'entry', 'entries') : undefined,
      ownerActionId: 'tab:journey',
    },
    {
      id: 'references',
      label: 'References',
      present: refCount > 0,
      detail: refCount > 0 ? pluralize(refCount, 'reference') : undefined,
      ownerActionId: 'tab:friends',
    },
    {
      id: 'availability',
      label: 'Open to coach',
      present: availability,
      ownerActionId: 'edit-profile',
    },
    {
      id: 'activity',
      label: 'Active recently',
      present: isRecentlyActive(p.last_active_at),
    },
  ]
}

function computeClubSignals(p: Profile): ProfileSnapshotSignal[] {
  // Phase 3+ may add a structured signal for `club_media` count via a
  // dedicated denormalized column; for now we don't have that data on the
  // profile row, so "Gallery" is omitted. We surface what is reliably
  // available without an extra fetch.
  const hasContact = hasText(p.website) || hasText(p.contact_email)
  const hasLeagues =
    hasText(p.mens_league_division) || hasText(p.womens_league_division)
  return [
    {
      id: 'logo',
      label: 'Club logo',
      present: hasText(p.avatar_url),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'location',
      label: 'Location & country',
      present: hasText(p.base_location) && hasNationality(p),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'year_founded',
      label: 'Year founded',
      present: Boolean(p.year_founded),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'bio',
      label: 'Club bio',
      present: hasText(p.club_bio),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'leagues',
      label: 'Leagues',
      present: hasLeagues,
      ownerActionId: 'edit-profile',
    },
    {
      id: 'contact',
      label: 'Contact details',
      present: hasContact,
      ownerActionId: 'edit-profile',
    },
    {
      id: 'activity',
      label: 'Active recently',
      present: isRecentlyActive(p.last_active_at),
    },
  ]
}

function computeBrandSignals(
  p: Profile,
  brand: ProfileSnapshotBrandFields | null,
  productCount: number,
  ambassadorCount: number,
  postCount: number,
): ProfileSnapshotSignal[] {
  // Brand snapshot reflects partnership-readiness (per v5 plan), not
  // recruitment evidence. Brand-specific fields (logo, bio, contact)
  // live on the brands table, so they come in via `brand` prop. Country
  // is profile-side (the brand owner's profile holds nationality).
  // When the brand prop is missing (defensive — caller forgot to pass
  // it), we treat all brand-side signals as missing rather than crash.
  const b = brand ?? { logo_url: null, bio: null, website_url: null, instagram_url: null }
  const hasContact = hasText(b.website_url) || hasText(b.instagram_url)
  return [
    {
      id: 'logo',
      label: 'Brand logo',
      present: hasText(b.logo_url),
      ownerActionId: 'edit-brand',
    },
    {
      id: 'bio',
      label: 'Brand bio',
      // Brand bios should be substantial enough to convey the brand story —
      // mirrors the 50-char threshold used in profileCompletion.ts for
      // "complete" brand bios.
      present: hasText(b.bio) && (b.bio?.trim().length ?? 0) >= 50,
      ownerActionId: 'edit-brand',
    },
    {
      id: 'contact',
      label: 'Contact details',
      present: hasContact,
      ownerActionId: 'edit-brand',
    },
    {
      id: 'location',
      label: 'Country',
      present: hasNationality(p),
      ownerActionId: 'edit-brand',
    },
    {
      id: 'products',
      label: 'Products',
      present: productCount > 0,
      detail: productCount > 0 ? pluralize(productCount, 'product') : undefined,
      ownerActionId: 'tab:products',
    },
    {
      id: 'ambassadors',
      label: 'Ambassadors',
      present: ambassadorCount > 0,
      detail: ambassadorCount > 0 ? pluralize(ambassadorCount, 'ambassador') : undefined,
      ownerActionId: 'tab:ambassadors',
    },
    {
      id: 'posts',
      label: 'Brand updates',
      present: postCount > 0,
      detail: postCount > 0 ? pluralize(postCount, 'post') : undefined,
      ownerActionId: 'tab:posts',
    },
  ]
}

function computeUmpireSignals(p: Profile): ProfileSnapshotSignal[] {
  const refCount = p.accepted_reference_count ?? 0
  const apptCount = p.umpire_appointment_count ?? 0
  const langCount = Array.isArray(p.languages) ? p.languages.length : 0
  return [
    {
      id: 'photo',
      label: 'Photo',
      present: hasText(p.avatar_url),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'level',
      label: 'Umpire level',
      present: hasText(p.umpire_level),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'federation',
      label: 'Federation',
      present: hasText(p.federation),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'specialization',
      label: 'Specialization',
      present: hasText(p.officiating_specialization),
      ownerActionId: 'edit-profile',
    },
    {
      id: 'languages',
      label: 'Languages',
      present: langCount > 0,
      detail: langCount > 0 ? pluralize(langCount, 'language') : undefined,
      ownerActionId: 'edit-profile',
    },
    {
      id: 'appointments',
      label: 'Officiating appointments',
      present: apptCount > 0,
      detail: apptCount > 0 ? pluralize(apptCount, 'appointment') : undefined,
      ownerActionId: 'tab:officiating',
    },
    {
      id: 'references',
      label: 'References',
      present: refCount > 0,
      detail: refCount > 0 ? pluralize(refCount, 'reference') : undefined,
      ownerActionId: 'tab:friends',
    },
    {
      id: 'bio',
      label: 'Bio',
      present: hasText(p.bio),
      ownerActionId: 'edit-profile',
    },
  ]
}

export function computeSignals(
  profile: Profile,
  brand: ProfileSnapshotBrandFields | null,
  brandProductCount: number,
  brandAmbassadorCount: number,
  brandPostCount: number,
): ProfileSnapshotSignal[] {
  switch (profile.role) {
    case 'player':
      return computePlayerSignals(profile)
    case 'coach':
      return computeCoachSignals(profile)
    case 'club':
      return computeClubSignals(profile)
    case 'brand':
      return computeBrandSignals(profile, brand, brandProductCount, brandAmbassadorCount, brandPostCount)
    case 'umpire':
      return computeUmpireSignals(profile)
    default:
      return []
  }
}

/** Per-role subtitle for the owner-side card. Public mode uses a neutral
 *  default in the component itself.
 *
 *  Coach branch is dual-mode: a coach who's flipped the recruiter flag is
 *  not "evaluated by clubs" in the candidate sense — they ARE the recruiter,
 *  so the candidate-side framing reads off-tone. The optional
 *  `coachRecruitsForTeam` argument routes them to a recruiter-aware string.
 */
export function getOwnerSubtitle(
  role: Profile['role'],
  coachRecruitsForTeam: boolean = false,
): string {
  switch (role) {
    case 'player':
      return 'What clubs see when they evaluate you'
    case 'coach':
      return coachRecruitsForTeam
        ? 'How your coaching profile reads to clubs and players you reach out to'
        : 'What clubs see when they evaluate you'
    case 'club':
      return 'What players, coaches, and brands see when they look at your club'
    case 'brand':
      return 'What people see when they discover your brand'
    case 'umpire':
      return 'What clubs and assigners see when they look at you'
    default:
      return 'What people see when they look at your profile'
  }
}
