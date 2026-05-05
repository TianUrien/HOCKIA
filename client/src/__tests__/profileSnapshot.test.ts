import { describe, it, expect } from 'vitest'
import { computeSignals } from '@/lib/profileSnapshotSignals'
import type { Profile } from '@/lib/supabase'

// Helper: build a Partial<Profile> + cast — the computeSignals helper only
// touches a small subset of profile fields, so mocking the full Row type
// would be noisy. The cast is safe because we test the exact fields the
// signals depend on; any new field the helper starts reading would surface
// in TS as an undefined access in the test (which we'd see + fix).
function makeProfile(role: Profile['role'], overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'test-id',
    role,
    full_name: 'Test User',
    ...overrides,
  } as unknown as Profile
}

const TWENTY_DAYS_AGO = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
const FIFTY_DAYS_AGO = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString()
const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
const SEVENTY_DAYS_AGO = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString()

// Compact wrapper matching the new computeSignals signature
// (profile, brand, productCount, ambassadorCount, postCount). Brand prop
// is null for non-brand roles, so we pass null by default and let the
// brand-specific tests build a fully-formed object inline.
const sigs = (profile: Profile) => computeSignals(profile, null, 0, 0, 0)

describe('computeSignals — player', () => {
  it('returns 8 signals in a fixed order', () => {
    const signals = sigs(makeProfile('player'))
    expect(signals).toHaveLength(8)
    expect(signals.map((s) => s.id)).toEqual([
      'photo',
      'position',
      'club',
      'references',
      'video',
      'journey',
      'availability',
      'activity',
    ])
  })

  it('marks photo present when avatar_url is non-empty', () => {
    const filled = sigs(makeProfile('player', { avatar_url: 'https://x.test/a.png' }))
    const empty = sigs(makeProfile('player', { avatar_url: null }))
    expect(filled.find((s) => s.id === 'photo')!.present).toBe(true)
    expect(empty.find((s) => s.id === 'photo')!.present).toBe(false)
  })

  it('treats whitespace-only avatar_url as missing', () => {
    const signals = sigs(makeProfile('player', { avatar_url: '   ' }))
    expect(signals.find((s) => s.id === 'photo')!.present).toBe(false)
  })

  it('requires BOTH position and playing_category for the position signal', () => {
    const onlyPosition = sigs(makeProfile('player', { position: 'defender', playing_category: null }))
    const both = sigs(makeProfile('player', { position: 'defender', playing_category: 'adult_men' }))
    expect(onlyPosition.find((s) => s.id === 'position')!.present).toBe(false)
    expect(both.find((s) => s.id === 'position')!.present).toBe(true)
  })

  it('club signal requires current_world_club_id (verified link), not just current_club text', () => {
    const textOnly = sigs(makeProfile('player', { current_club: 'Some FC', current_world_club_id: null }))
    const linked = sigs(makeProfile('player', { current_club: 'Some FC', current_world_club_id: 'wc-1' }))
    expect(textOnly.find((s) => s.id === 'club')!.present).toBe(false)
    expect(linked.find((s) => s.id === 'club')!.present).toBe(true)
  })

  it('renders reference count detail with correct singular / plural', () => {
    const one = sigs(makeProfile('player', { accepted_reference_count: 1 }))
    const three = sigs(makeProfile('player', { accepted_reference_count: 3 }))
    const zero = sigs(makeProfile('player', { accepted_reference_count: 0 }))
    expect(one.find((s) => s.id === 'references')!.detail).toBe('1 reference')
    expect(three.find((s) => s.id === 'references')!.detail).toBe('3 references')
    expect(zero.find((s) => s.id === 'references')!.detail).toBeUndefined()
  })

  it('career-journey signal uses entries plural, references uses references plural', () => {
    const signals = sigs(makeProfile('player', {
      career_entry_count: 2,
      accepted_reference_count: 2,
    }))
    expect(signals.find((s) => s.id === 'journey')!.detail).toBe('2 entries')
    expect(signals.find((s) => s.id === 'references')!.detail).toBe('2 references')
  })

  it('availability is true when EITHER open_to_play OR open_to_opportunities is true (legacy: never confirmed)', () => {
    // Legacy users predating the L2 check-in have NULL availability_confirmed_at.
    // The boolean alone wins — no retroactive decay.
    const onlyPlay = sigs(makeProfile('player', { open_to_play: true }))
    const onlyOpportunities = sigs(makeProfile('player', { open_to_opportunities: true }))
    const neither = sigs(makeProfile('player', { open_to_play: false, open_to_opportunities: false }))
    expect(onlyPlay.find((s) => s.id === 'availability')!.present).toBe(true)
    expect(onlyOpportunities.find((s) => s.id === 'availability')!.present).toBe(true)
    expect(neither.find((s) => s.id === 'availability')!.present).toBe(false)
  })

  it('availability decays 60 days after last confirmation', () => {
    // L2 Loop Layer: once a user has confirmed at least once, availability
    // requires re-confirmation within 60 days. Boolean true alone is no
    // longer enough.
    const justConfirmed = sigs(makeProfile('player', {
      open_to_play: true,
      availability_confirmed_at: TWENTY_DAYS_AGO,
    }))
    const stillFresh = sigs(makeProfile('player', {
      open_to_play: true,
      availability_confirmed_at: FIFTY_DAYS_AGO,
    }))
    const decayed = sigs(makeProfile('player', {
      open_to_play: true,
      availability_confirmed_at: SEVENTY_DAYS_AGO,
    }))
    const decayedButNotOpen = sigs(makeProfile('player', {
      open_to_play: false,
      availability_confirmed_at: TWENTY_DAYS_AGO,
    }))
    expect(justConfirmed.find((s) => s.id === 'availability')!.present).toBe(true)
    expect(stillFresh.find((s) => s.id === 'availability')!.present).toBe(true)
    expect(decayed.find((s) => s.id === 'availability')!.present).toBe(false)
    // Boolean still gates first — confirmed but not open = not present
    expect(decayedButNotOpen.find((s) => s.id === 'availability')!.present).toBe(false)
  })

  it('activity is true when last_active_at is within 30 days, false beyond', () => {
    const recent = sigs(makeProfile('player', { last_active_at: TWENTY_DAYS_AGO }))
    const stale = sigs(makeProfile('player', { last_active_at: SIXTY_DAYS_AGO }))
    const never = sigs(makeProfile('player', { last_active_at: null }))
    expect(recent.find((s) => s.id === 'activity')!.present).toBe(true)
    expect(stale.find((s) => s.id === 'activity')!.present).toBe(false)
    expect(never.find((s) => s.id === 'activity')!.present).toBe(false)
  })
})

describe('computeSignals — coach', () => {
  it('returns 8 signals with coach-specific ids', () => {
    const signals = sigs(makeProfile('coach'))
    expect(signals.map((s) => s.id)).toEqual([
      'photo',
      'specialization',
      'categories',
      'bio',
      'journey',
      'references',
      'availability',
      'activity',
    ])
  })

  it('coaching_categories signal requires non-empty array', () => {
    const empty = sigs(makeProfile('coach', { coaching_categories: [] }))
    const withOne = sigs(makeProfile('coach', { coaching_categories: ['adult_women'] }))
    expect(empty.find((s) => s.id === 'categories')!.present).toBe(false)
    expect(withOne.find((s) => s.id === 'categories')!.present).toBe(true)
  })

  it('availability uses open_to_coach instead of open_to_play', () => {
    const onlyCoach = sigs(makeProfile('coach', { open_to_coach: true, open_to_play: false }))
    const onlyPlay = sigs(makeProfile('coach', { open_to_coach: false, open_to_play: true }))
    expect(onlyCoach.find((s) => s.id === 'availability')!.present).toBe(true)
    // A coach with open_to_play=true (but not open_to_coach) doesn't count
    // as "open to coach" — we deliberately don't conflate the booleans.
    expect(onlyPlay.find((s) => s.id === 'availability')!.present).toBe(false)
  })
})

describe('computeSignals — club', () => {
  it('returns 7 signals with club-specific ids', () => {
    const signals = sigs(makeProfile('club'))
    expect(signals.map((s) => s.id)).toEqual([
      'logo',
      'location',
      'year_founded',
      'bio',
      'leagues',
      'contact',
      'activity',
    ])
  })

  it('contact signal accepts EITHER website OR contact_email', () => {
    const websiteOnly = sigs(makeProfile('club', { website: 'https://x.test', contact_email: null }))
    const emailOnly = sigs(makeProfile('club', { website: null, contact_email: 'a@b.test' }))
    const neither = sigs(makeProfile('club', { website: null, contact_email: null }))
    expect(websiteOnly.find((s) => s.id === 'contact')!.present).toBe(true)
    expect(emailOnly.find((s) => s.id === 'contact')!.present).toBe(true)
    expect(neither.find((s) => s.id === 'contact')!.present).toBe(false)
  })
})

describe('computeSignals — brand', () => {
  it('returns 7 signals with brand-specific ids', () => {
    const signals = sigs(makeProfile('brand'))
    expect(signals.map((s) => s.id)).toEqual([
      'logo',
      'bio',
      'contact',
      'location',
      'products',
      'ambassadors',
      'posts',
    ])
  })

  it('brand counts come from props (not profile fields)', () => {
    const signals = computeSignals(
      makeProfile('brand'),
      { logo_url: null, bio: null, website_url: null, instagram_url: null },
      3, 5, 12,
    )
    expect(signals.find((s) => s.id === 'products')!.detail).toBe('3 products')
    expect(signals.find((s) => s.id === 'ambassadors')!.detail).toBe('5 ambassadors')
    expect(signals.find((s) => s.id === 'posts')!.detail).toBe('12 posts')
  })

  it('brand bio reads from the brand prop, not profile.bio (50-char threshold)', () => {
    const tooShort = computeSignals(
      makeProfile('brand'),
      { logo_url: null, bio: 'Just a short tagline.', website_url: null, instagram_url: null }, // 21 chars
      0, 0, 0,
    )
    const longEnough = computeSignals(
      makeProfile('brand'),
      {
        logo_url: null,
        bio: 'A longer brand bio that crosses the fifty-character threshold cleanly.',
        website_url: null,
        instagram_url: null,
      },
      0, 0, 0,
    )
    expect(tooShort.find((s) => s.id === 'bio')!.present).toBe(false)
    expect(longEnough.find((s) => s.id === 'bio')!.present).toBe(true)
  })

  it('brand logo + contact read from brand prop, not profile fields', () => {
    // Profile-side avatar_url + website are intentionally set to validate
    // that the snapshot ignores them for brand role — brand identity lives
    // on the brands table.
    const signals = computeSignals(
      makeProfile('brand', {
        avatar_url: 'https://x.test/profile-avatar.png',
        website: 'https://profile-website.test',
      }),
      { logo_url: null, bio: null, website_url: null, instagram_url: null },
      0, 0, 0,
    )
    expect(signals.find((s) => s.id === 'logo')!.present).toBe(false)
    expect(signals.find((s) => s.id === 'contact')!.present).toBe(false)
  })

  it('brand contact accepts EITHER website_url OR instagram_url on the brand', () => {
    const onlyWeb = computeSignals(
      makeProfile('brand'),
      { logo_url: null, bio: null, website_url: 'https://x.test', instagram_url: null },
      0, 0, 0,
    )
    const onlyIg = computeSignals(
      makeProfile('brand'),
      { logo_url: null, bio: null, website_url: null, instagram_url: 'https://instagram.com/x' },
      0, 0, 0,
    )
    expect(onlyWeb.find((s) => s.id === 'contact')!.present).toBe(true)
    expect(onlyIg.find((s) => s.id === 'contact')!.present).toBe(true)
  })

  it('falls back to all-missing brand signals when brand prop is null', () => {
    const signals = sigs(makeProfile('brand'))
    expect(signals.find((s) => s.id === 'logo')!.present).toBe(false)
    expect(signals.find((s) => s.id === 'bio')!.present).toBe(false)
    expect(signals.find((s) => s.id === 'contact')!.present).toBe(false)
  })

  it('brand snapshot omits the activity signal — partnership-readiness, not recency', () => {
    const signals = sigs(makeProfile('brand'))
    expect(signals.some((s) => s.id === 'activity')).toBe(false)
  })
})

describe('computeSignals — umpire', () => {
  it('returns 8 signals with umpire-specific ids', () => {
    const signals = sigs(makeProfile('umpire'))
    expect(signals.map((s) => s.id)).toEqual([
      'photo',
      'level',
      'federation',
      'specialization',
      'languages',
      'appointments',
      'references',
      'bio',
    ])
  })

  it('languages signal counts the array length', () => {
    const none = sigs(makeProfile('umpire', { languages: [] }))
    const two = sigs(makeProfile('umpire', { languages: ['English', 'Spanish'] }))
    expect(none.find((s) => s.id === 'languages')!.present).toBe(false)
    expect(two.find((s) => s.id === 'languages')!.detail).toBe('2 languages')
  })

  it('appointments signal pulls from umpire_appointment_count denormalized field', () => {
    const zero = sigs(makeProfile('umpire', { umpire_appointment_count: 0 }))
    const five = sigs(makeProfile('umpire', { umpire_appointment_count: 5 }))
    expect(zero.find((s) => s.id === 'appointments')!.present).toBe(false)
    expect(five.find((s) => s.id === 'appointments')!.detail).toBe('5 appointments')
  })

  it('umpire snapshot omits the activity signal — credibility surface, not engagement', () => {
    const signals = sigs(makeProfile('umpire'))
    expect(signals.some((s) => s.id === 'activity')).toBe(false)
  })
})

describe('computeSignals — unknown role fallback', () => {
  it('returns an empty array for an unrecognised role', () => {
    // Cast to bypass TS narrowing — simulating bad data from a future role
    // not yet in this client build.
    const signals = sigs(makeProfile('player', { role: 'admin' as Profile['role'] }))
    expect(signals).toEqual([])
  })
})
