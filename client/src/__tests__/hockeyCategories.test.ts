import { describe, expect, it } from 'vitest'
import {
  ANY_CATEGORY,
  CATEGORY_LABELS,
  PLAYING_CATEGORIES,
  categoriesToDisplay,
  categoryToDisplay,
  isOpenToAny,
  isValidCategoryArray,
  isValidPlayingCategory,
  legacyGenderToPlayingCategory,
  playingCategoryToLegacyGender,
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
