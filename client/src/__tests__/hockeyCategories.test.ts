import { describe, expect, it } from 'vitest'
import {
  ANY_CATEGORY,
  CATEGORY_LABELS,
  OPPORTUNITY_GENDERS,
  PLAYING_CATEGORIES,
  categoriesToDisplay,
  categoryToDisplay,
  isOpenToAny,
  isValidCategoryArray,
  isValidPlayingCategory,
  legacyGenderToPlayingCategory,
  opportunityGenderToDisplay,
  opportunityGenderToPlayingCategory,
  opportunityGenderToTeamLabel,
  playingCategoryToLegacyGender,
  playingCategoryToOpportunityGender,
} from '@/lib/hockeyCategories'

describe('CATEGORY_LABELS', () => {
  it('exposes a label for every value the schema allows', () => {
    for (const cat of [...PLAYING_CATEGORIES, ANY_CATEGORY]) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy()
    }
  })
})

describe('categoryToDisplay', () => {
  it('returns labelled strings for valid categories', () => {
    expect(categoryToDisplay('adult_women')).toBe('Adult Women')
    expect(categoryToDisplay('adult_men')).toBe('Adult Men')
    expect(categoryToDisplay('girls')).toBe('Girls')
    expect(categoryToDisplay('boys')).toBe('Boys')
    expect(categoryToDisplay('mixed')).toBe('Mixed')
    expect(categoryToDisplay('any')).toBe('Any category')
  })

  it('returns empty string for null / undefined / unknown', () => {
    expect(categoryToDisplay(null)).toBe('')
    expect(categoryToDisplay(undefined)).toBe('')
    expect(categoryToDisplay('')).toBe('')
    expect(categoryToDisplay('xyz')).toBe('')
  })
})

describe('categoriesToDisplay', () => {
  it('joins multiple specific categories with commas', () => {
    expect(categoriesToDisplay(['adult_women', 'girls'])).toBe('Adult Women, Girls')
    expect(categoriesToDisplay(['adult_men', 'boys', 'mixed'])).toBe('Adult Men, Boys, Mixed')
  })

  it("collapses to 'Any category' when the array is the sentinel", () => {
    expect(categoriesToDisplay(['any'])).toBe('Any category')
  })

  it('returns empty string for null / empty array', () => {
    expect(categoriesToDisplay(null)).toBe('')
    expect(categoriesToDisplay(undefined)).toBe('')
    expect(categoriesToDisplay([])).toBe('')
  })
})

describe('isOpenToAny', () => {
  it('returns true when the array contains the any sentinel', () => {
    expect(isOpenToAny(['any'])).toBe(true)
  })

  it('returns false for arrays of specific categories', () => {
    expect(isOpenToAny(['adult_women'])).toBe(false)
    expect(isOpenToAny(['adult_women', 'girls'])).toBe(false)
  })

  it('returns false for null / empty', () => {
    expect(isOpenToAny(null)).toBe(false)
    expect(isOpenToAny(undefined)).toBe(false)
    expect(isOpenToAny([])).toBe(false)
  })
})

describe('legacyGenderToPlayingCategory', () => {
  it('maps Men/Women to adult_men/adult_women', () => {
    expect(legacyGenderToPlayingCategory('Men')).toBe('adult_men')
    expect(legacyGenderToPlayingCategory('Women')).toBe('adult_women')
  })

  it('is case-insensitive on input', () => {
    expect(legacyGenderToPlayingCategory('men')).toBe('adult_men')
    expect(legacyGenderToPlayingCategory('WOMEN')).toBe('adult_women')
    expect(legacyGenderToPlayingCategory('Male')).toBe('adult_men')
    expect(legacyGenderToPlayingCategory('female')).toBe('adult_women')
  })

  it('returns null for empty / null / unknown', () => {
    expect(legacyGenderToPlayingCategory(null)).toBeNull()
    expect(legacyGenderToPlayingCategory(undefined)).toBeNull()
    expect(legacyGenderToPlayingCategory('')).toBeNull()
    expect(legacyGenderToPlayingCategory('Other')).toBeNull()
  })
})

describe('playingCategoryToLegacyGender', () => {
  it('maps adult_men/adult_women back to legacy values', () => {
    expect(playingCategoryToLegacyGender('adult_men')).toBe('Men')
    expect(playingCategoryToLegacyGender('adult_women')).toBe('Women')
  })

  it('returns null for categories with no legacy equivalent', () => {
    expect(playingCategoryToLegacyGender('girls')).toBeNull()
    expect(playingCategoryToLegacyGender('boys')).toBeNull()
    expect(playingCategoryToLegacyGender('mixed')).toBeNull()
    expect(playingCategoryToLegacyGender(null)).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────
// Phase 3d — opportunity_gender enum mapping
// ────────────────────────────────────────────────────────────────────────

describe('opportunityGenderToDisplay', () => {
  it('renders legacy Men / Women as the new "Adult" labels', () => {
    expect(opportunityGenderToDisplay('Men')).toBe('Adult Men')
    expect(opportunityGenderToDisplay('Women')).toBe('Adult Women')
  })

  it('renders Girls / Boys / Mixed verbatim', () => {
    expect(opportunityGenderToDisplay('Girls')).toBe('Girls')
    expect(opportunityGenderToDisplay('Boys')).toBe('Boys')
    expect(opportunityGenderToDisplay('Mixed')).toBe('Mixed')
  })

  it('returns empty string for null / unknown', () => {
    expect(opportunityGenderToDisplay(null)).toBe('')
    expect(opportunityGenderToDisplay(undefined)).toBe('')
    expect(opportunityGenderToDisplay('')).toBe('')
    expect(opportunityGenderToDisplay('xyz')).toBe('')
  })
})

describe('opportunityGenderToTeamLabel', () => {
  it("uses possessive forms for Men's / Women's / Girls' / Boys'", () => {
    expect(opportunityGenderToTeamLabel('Men')).toBe("Men's Team")
    expect(opportunityGenderToTeamLabel('Women')).toBe("Women's Team")
    expect(opportunityGenderToTeamLabel('Girls')).toBe("Girls' Team")
    expect(opportunityGenderToTeamLabel('Boys')).toBe("Boys' Team")
  })

  it('uses non-possessive for Mixed (reads more naturally)', () => {
    expect(opportunityGenderToTeamLabel('Mixed')).toBe('Mixed Team')
  })

  it('returns empty for null / unknown', () => {
    expect(opportunityGenderToTeamLabel(null)).toBe('')
    expect(opportunityGenderToTeamLabel(undefined)).toBe('')
  })
})

describe('playingCategoryToOpportunityGender (player → vacancy filter)', () => {
  // The user's specific verification cases:
  it('matches Adult Men player to legacy Men opportunity', () => {
    expect(playingCategoryToOpportunityGender('adult_men')).toBe('Men')
  })

  it('matches Adult Women player to legacy Women opportunity', () => {
    expect(playingCategoryToOpportunityGender('adult_women')).toBe('Women')
  })

  it('matches Girls player to Girls opportunity', () => {
    expect(playingCategoryToOpportunityGender('girls')).toBe('Girls')
  })

  it('matches Boys player to Boys opportunity', () => {
    expect(playingCategoryToOpportunityGender('boys')).toBe('Boys')
  })

  it('matches Mixed player to Mixed opportunity', () => {
    expect(playingCategoryToOpportunityGender('mixed')).toBe('Mixed')
  })

  it('returns null for empty / unknown', () => {
    expect(playingCategoryToOpportunityGender(null)).toBeNull()
    expect(playingCategoryToOpportunityGender(undefined)).toBeNull()
  })
})

describe('opportunityGenderToPlayingCategory (reverse)', () => {
  it('inverts the mapping', () => {
    for (const enumVal of OPPORTUNITY_GENDERS) {
      const cat = opportunityGenderToPlayingCategory(enumVal)
      expect(cat).not.toBeNull()
      expect(playingCategoryToOpportunityGender(cat!)).toBe(enumVal)
    }
  })

  it('returns null for unknown values', () => {
    expect(opportunityGenderToPlayingCategory(null)).toBeNull()
    expect(opportunityGenderToPlayingCategory('xyz')).toBeNull()
  })
})

describe('OPPORTUNITY_GENDERS constant', () => {
  it('exposes the full Phase 3d enum in declaration order', () => {
    expect(OPPORTUNITY_GENDERS).toEqual(['Men', 'Women', 'Girls', 'Boys', 'Mixed'])
  })
})

describe('isValidPlayingCategory', () => {
  it('accepts the 5 valid values', () => {
    for (const cat of PLAYING_CATEGORIES) {
      expect(isValidPlayingCategory(cat)).toBe(true)
    }
  })

  it("rejects 'any' (player can't pick any)", () => {
    expect(isValidPlayingCategory('any')).toBe(false)
  })

  it('rejects null, empty, and unknown', () => {
    expect(isValidPlayingCategory(null)).toBe(false)
    expect(isValidPlayingCategory(undefined)).toBe(false)
    expect(isValidPlayingCategory('')).toBe(false)
    expect(isValidPlayingCategory('xyz')).toBe(false)
  })
})

describe('isValidCategoryArray', () => {
  it('accepts null (means not specified)', () => {
    expect(isValidCategoryArray(null)).toBe(true)
    expect(isValidCategoryArray(undefined)).toBe(true)
  })

  it('rejects empty array', () => {
    expect(isValidCategoryArray([])).toBe(false)
  })

  it('accepts arrays of valid values', () => {
    expect(isValidCategoryArray(['adult_women'])).toBe(true)
    expect(isValidCategoryArray(['adult_men', 'girls', 'boys'])).toBe(true)
    expect(isValidCategoryArray(['mixed'])).toBe(true)
  })

  it("accepts the [any] sentinel", () => {
    expect(isValidCategoryArray(['any'])).toBe(true)
  })

  it("rejects 'any' mixed with specific categories (exclusivity rule)", () => {
    expect(isValidCategoryArray(['any', 'adult_women'])).toBe(false)
    expect(isValidCategoryArray(['adult_men', 'any'])).toBe(false)
  })

  it('rejects unknown values', () => {
    expect(isValidCategoryArray(['xyz'])).toBe(false)
    expect(isValidCategoryArray(['adult_women', 'foo'])).toBe(false)
  })
})
