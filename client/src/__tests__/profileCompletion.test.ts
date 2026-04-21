import { isProfileComplete, type CommunityMemberFields } from '@/lib/profileCompletion'

// ── Helpers to build "complete" fixtures per role; then strip individual fields
// to confirm the predicate flips to false.

const completePlayer: CommunityMemberFields = {
  role: 'player',
  full_name: 'Alex Player',
  avatar_url: 'https://example.com/a.png',
  nationality_country_id: 202,
  base_location: 'Amsterdam, Netherlands',
  position: 'midfielder',
  highlight_video_url: 'https://youtu.be/abc',
  career_entry_count: 3,
  accepted_friend_count: 4,
  accepted_reference_count: 2,
}

const completeCoach: CommunityMemberFields = {
  role: 'coach',
  full_name: 'Casey Coach',
  avatar_url: 'https://example.com/c.png',
  nationality_country_id: 5,
  base_location: 'Brussels, Belgium',
  coach_specialization: 'head_coach',
  bio: 'Twenty years coaching first-division clubs in Europe.',
  career_entry_count: 5,
  accepted_reference_count: 3,
}

const completeClub: CommunityMemberFields = {
  role: 'club',
  full_name: 'HC Example',
  avatar_url: 'https://example.com/logo.png',
  nationality_country_id: 41,
  base_location: 'Barcelona, Spain',
  year_founded: 1945,
  website: 'https://hcexample.com',
  club_bio: 'Long-running club with multiple divisions.',
}

const completeBrand: CommunityMemberFields = {
  role: 'brand',
  full_name: 'Acme Hockey',
  avatar_url: 'https://example.com/brand-logo.png',
  nationality_country_id: 15,
  brand_category: 'equipment',
  brand_bio: 'Premium hockey equipment made in Germany since 1982 for elite players.',
  brand_website_url: 'https://acmehockey.com',
}

const completeUmpire: CommunityMemberFields = {
  role: 'umpire',
  full_name: 'Umi Umpire',
  avatar_url: 'https://example.com/u.png',
  nationality_country_id: 11,
  base_location: 'London',
  bio: 'Twenty years officiating first-division matches across Europe.',
  umpire_level: 'FIH International',
  federation: 'FIH',
  umpire_since: 2015,
  officiating_specialization: 'outdoor',
  languages: ['English', 'Spanish'],
}

describe('isProfileComplete', () => {
  describe('player', () => {
    it('returns true for a fully complete player', () => {
      expect(isProfileComplete(completePlayer)).toBe(true)
    })

    it('accepts legacy nationality text in place of nationality_country_id', () => {
      expect(
        isProfileComplete({
          ...completePlayer,
          nationality_country_id: null,
          nationality: 'Dutch',
        })
      ).toBe(true)
    })

    it.each([
      'avatar_url',
      'base_location',
      'position',
      'highlight_video_url',
    ] as const)('returns false when %s is missing', (field) => {
      expect(isProfileComplete({ ...completePlayer, [field]: null })).toBe(false)
    })

    it('returns false when nationality is missing entirely', () => {
      expect(
        isProfileComplete({
          ...completePlayer,
          nationality_country_id: null,
          nationality: null,
        })
      ).toBe(false)
    })

    it('returns false when career_entry_count is zero', () => {
      expect(isProfileComplete({ ...completePlayer, career_entry_count: 0 })).toBe(false)
    })

    it('returns false when accepted_friend_count is zero', () => {
      expect(isProfileComplete({ ...completePlayer, accepted_friend_count: 0 })).toBe(false)
    })

    it('returns false when accepted_reference_count is zero', () => {
      expect(isProfileComplete({ ...completePlayer, accepted_reference_count: 0 })).toBe(false)
    })

    it('treats whitespace-only text as missing', () => {
      expect(isProfileComplete({ ...completePlayer, position: '   ' })).toBe(false)
    })
  })

  describe('coach', () => {
    it('returns true for a fully complete coach', () => {
      expect(isProfileComplete(completeCoach)).toBe(true)
    })

    it.each([
      'full_name',
      'avatar_url',
      'base_location',
      'coach_specialization',
      'bio',
    ] as const)('returns false when %s is missing', (field) => {
      expect(isProfileComplete({ ...completeCoach, [field]: null })).toBe(false)
    })

    it('returns false when journey entries are missing', () => {
      expect(isProfileComplete({ ...completeCoach, career_entry_count: 0 })).toBe(false)
    })

    it('returns false when references are missing', () => {
      expect(isProfileComplete({ ...completeCoach, accepted_reference_count: 0 })).toBe(false)
    })
  })

  describe('club', () => {
    it('returns true for a fully complete club', () => {
      expect(isProfileComplete(completeClub)).toBe(true)
    })

    it('accepts contact_email in place of website as the contact method', () => {
      expect(
        isProfileComplete({
          ...completeClub,
          website: null,
          contact_email: 'hello@hcexample.com',
        })
      ).toBe(true)
    })

    it('returns false when neither website nor contact_email is provided', () => {
      expect(
        isProfileComplete({ ...completeClub, website: null, contact_email: null })
      ).toBe(false)
    })

    it.each(['avatar_url', 'base_location', 'club_bio'] as const)(
      'returns false when %s is missing',
      (field) => {
        expect(isProfileComplete({ ...completeClub, [field]: null })).toBe(false)
      }
    )

    it('returns false when year_founded is missing', () => {
      expect(isProfileComplete({ ...completeClub, year_founded: null })).toBe(false)
    })
  })

  describe('brand', () => {
    it('returns true for a fully complete brand', () => {
      expect(isProfileComplete(completeBrand)).toBe(true)
    })

    it('accepts instagram_url in place of website_url', () => {
      expect(
        isProfileComplete({
          ...completeBrand,
          brand_website_url: null,
          brand_instagram_url: 'https://instagram.com/acmehockey',
        })
      ).toBe(true)
    })

    it.each(['full_name', 'avatar_url', 'brand_category'] as const)(
      'returns false when %s is missing (identity bucket)',
      (field) => {
        expect(isProfileComplete({ ...completeBrand, [field]: null })).toBe(false)
      }
    )

    it('returns false when bio is below the 50-character threshold', () => {
      expect(
        isProfileComplete({
          ...completeBrand,
          brand_bio: 'Short bio.',
        })
      ).toBe(false)
    })

    it('returns false when neither website nor instagram is provided', () => {
      expect(
        isProfileComplete({
          ...completeBrand,
          brand_website_url: null,
          brand_instagram_url: null,
        })
      ).toBe(false)
    })

    it('returns false when the brand has no country', () => {
      expect(
        isProfileComplete({
          ...completeBrand,
          nationality_country_id: null,
          nationality: null,
        })
      ).toBe(false)
    })
  })

  describe('umpire', () => {
    it('returns true for a fully complete umpire', () => {
      expect(isProfileComplete(completeUmpire)).toBe(true)
    })

    it.each([
      'avatar_url',
      'base_location',
      'bio',
      'umpire_level',
      'federation',
      'officiating_specialization',
    ] as const)('returns false when %s is missing', (field) => {
      expect(isProfileComplete({ ...completeUmpire, [field]: null })).toBe(false)
    })

    it('returns false when no languages are set', () => {
      expect(isProfileComplete({ ...completeUmpire, languages: [] })).toBe(false)
    })

    it('returns false when nationality is missing', () => {
      expect(
        isProfileComplete({
          ...completeUmpire,
          nationality_country_id: null,
          nationality: null,
        })
      ).toBe(false)
    })
  })

  it('returns false for an unknown role', () => {
    const unknown = { ...completePlayer, role: 'alien' as unknown as 'player' }
    expect(isProfileComplete(unknown)).toBe(false)
  })
})
