import {
  calculateTier,
  estimateMemberStrength,
  getMemberTier,
  TIER_THRESHOLDS,
  type ProfileTier,
} from '@/lib/profileTier'
import type { CommunityMemberFields } from '@/lib/profileCompletion'

// Fully complete fixtures per role — each "all community-visible buckets
// filled" case should land in Elite (≥ 90%) after the hook's weights are
// rescaled to 100. Parallel structure to profileCompletion.test.ts.
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

const emptyPlayer: CommunityMemberFields = { role: 'player' }
const emptyCoach: CommunityMemberFields = { role: 'coach' }
const emptyClub: CommunityMemberFields = { role: 'club' }
const emptyBrand: CommunityMemberFields = { role: 'brand' }
const emptyUmpire: CommunityMemberFields = { role: 'umpire' }

describe('calculateTier', () => {
  it('maps 0% to rookie', () => {
    expect(calculateTier(0)).toBe<ProfileTier>('rookie')
  })

  it('maps values just below the active threshold to rookie', () => {
    expect(calculateTier(TIER_THRESHOLDS.active - 1)).toBe<ProfileTier>('rookie')
  })

  it('maps the active threshold exactly to active', () => {
    expect(calculateTier(TIER_THRESHOLDS.active)).toBe<ProfileTier>('active')
  })

  it('maps values just below the rising threshold to active', () => {
    expect(calculateTier(TIER_THRESHOLDS.rising - 1)).toBe<ProfileTier>('active')
  })

  it('maps the rising threshold exactly to rising', () => {
    expect(calculateTier(TIER_THRESHOLDS.rising)).toBe<ProfileTier>('rising')
  })

  it('maps values just below the elite threshold to rising', () => {
    expect(calculateTier(TIER_THRESHOLDS.elite - 1)).toBe<ProfileTier>('rising')
  })

  it('maps the elite threshold exactly to elite', () => {
    expect(calculateTier(TIER_THRESHOLDS.elite)).toBe<ProfileTier>('elite')
  })

  it('maps 100% to elite', () => {
    expect(calculateTier(100)).toBe<ProfileTier>('elite')
  })

  it('clamps negative percentages to rookie', () => {
    expect(calculateTier(-25)).toBe<ProfileTier>('rookie')
  })

  it('clamps percentages above 100 to elite', () => {
    expect(calculateTier(175)).toBe<ProfileTier>('elite')
  })

  it('treats non-finite values as 0 (rookie)', () => {
    expect(calculateTier(NaN)).toBe<ProfileTier>('rookie')
    expect(calculateTier(Infinity)).toBe<ProfileTier>('rookie')
    expect(calculateTier(-Infinity)).toBe<ProfileTier>('rookie')
  })
})

describe('estimateMemberStrength', () => {
  describe('player', () => {
    it('returns 100 when all community-visible buckets are filled', () => {
      expect(estimateMemberStrength(completePlayer)).toBe(100)
    })

    it('returns 0 for an empty player profile', () => {
      expect(estimateMemberStrength(emptyPlayer)).toBe(0)
    })

    it('accepts legacy nationality text in place of nationality_country_id', () => {
      expect(
        estimateMemberStrength({
          ...completePlayer,
          nationality_country_id: null,
          nationality: 'Dutch',
        })
      ).toBe(100)
    })

    it('drops only the highlight-video bucket when the video is missing', () => {
      // 20/90 weight lost → round((70/90)*100) = 78
      expect(
        estimateMemberStrength({ ...completePlayer, highlight_video_url: null })
      ).toBe(78)
    })

    it('counts zero career entries as an incomplete journey bucket', () => {
      // 15/90 weight lost → round((75/90)*100) = 83
      expect(
        estimateMemberStrength({ ...completePlayer, career_entry_count: 0 })
      ).toBe(83)
    })
  })

  describe('coach', () => {
    it('returns 100 when all community-visible buckets are filled', () => {
      expect(estimateMemberStrength(completeCoach)).toBe(100)
    })

    it('returns 0 for an empty coach profile', () => {
      expect(estimateMemberStrength(emptyCoach)).toBe(0)
    })

    it('drops only the bio bucket when bio is missing', () => {
      // 20/90 weight lost → round((70/90)*100) = 78
      expect(estimateMemberStrength({ ...completeCoach, bio: null })).toBe(78)
    })
  })

  describe('club', () => {
    it('returns 100 when all community-visible buckets are filled', () => {
      expect(estimateMemberStrength(completeClub)).toBe(100)
    })

    it('returns 0 for an empty club profile', () => {
      expect(estimateMemberStrength(emptyClub)).toBe(0)
    })

    it('accepts contact_email as a substitute for website in the basic bucket', () => {
      expect(
        estimateMemberStrength({
          ...completeClub,
          website: null,
          contact_email: 'hello@hcexample.com',
        })
      ).toBe(100)
    })

    it('drops only the logo bucket when avatar_url is missing', () => {
      // 25/80 weight lost → round((55/80)*100) = 69
      expect(estimateMemberStrength({ ...completeClub, avatar_url: null })).toBe(69)
    })
  })

  describe('brand', () => {
    it('returns 100 when all community-visible buckets are filled', () => {
      expect(estimateMemberStrength(completeBrand)).toBe(100)
    })

    it('returns 0 for an empty brand profile', () => {
      expect(estimateMemberStrength(emptyBrand)).toBe(0)
    })

    it('accepts instagram_url as a substitute for website_url in the contact bucket', () => {
      expect(
        estimateMemberStrength({
          ...completeBrand,
          brand_website_url: null,
          brand_instagram_url: 'https://instagram.com/acmehockey',
        })
      ).toBe(100)
    })

    it('rejects short bios (<50 chars) from the about bucket', () => {
      // 20/70 weight lost → round((50/70)*100) = 71
      expect(
        estimateMemberStrength({ ...completeBrand, brand_bio: 'Short bio.' })
      ).toBe(71)
    })
  })

  describe('umpire', () => {
    it('returns 100 when all credentials + bio + languages + photo are set', () => {
      expect(estimateMemberStrength(completeUmpire)).toBe(100)
    })

    it('returns 0 for an empty umpire profile', () => {
      expect(estimateMemberStrength(emptyUmpire)).toBe(0)
    })

    it('drops only the federation bucket (20/100) when federation is missing', () => {
      expect(
        estimateMemberStrength({ ...completeUmpire, federation: null })
      ).toBe(80)
    })

    it('drops only the level bucket (25/100) when level is missing', () => {
      expect(
        estimateMemberStrength({ ...completeUmpire, umpire_level: null })
      ).toBe(75)
    })

    it('drops only the languages bucket (10/100) when languages is empty', () => {
      expect(
        estimateMemberStrength({ ...completeUmpire, languages: [] })
      ).toBe(90)
    })
  })

  it('returns 0 for an unknown role', () => {
    const unknown = { role: 'alien' } as unknown as CommunityMemberFields
    expect(estimateMemberStrength(unknown)).toBe(0)
  })
})

describe('getMemberTier', () => {
  it('lands on elite for a fully complete player', () => {
    expect(getMemberTier(completePlayer)).toBe<ProfileTier>('elite')
  })

  it('lands on elite for a fully complete coach', () => {
    expect(getMemberTier(completeCoach)).toBe<ProfileTier>('elite')
  })

  it('lands on elite for a fully complete club', () => {
    expect(getMemberTier(completeClub)).toBe<ProfileTier>('elite')
  })

  it('lands on elite for a fully complete umpire', () => {
    expect(getMemberTier(completeUmpire)).toBe<ProfileTier>('elite')
  })

  it('lands on elite for a fully complete brand', () => {
    expect(getMemberTier(completeBrand)).toBe<ProfileTier>('elite')
  })

  it('lands on rookie for an empty player profile', () => {
    expect(getMemberTier(emptyPlayer)).toBe<ProfileTier>('rookie')
  })
})
