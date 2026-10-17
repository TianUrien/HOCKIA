import { describe, expect, it } from 'vitest'
import { CATEGORY_DOT_CLASSES, categoryFamily, categoryTagClass, genderPill } from '@/lib/opportunityCopy'

/**
 * Founder ruling 2026-10-16 (Opportunities v2): women's and men's teams carry
 * their own colours — not pink / blue — from the Figma category/* variables:
 * women #be123c, men #0369a1, mixed #6c2bd9. Girls and Boys follow the
 * women's and men's palettes. Colour only in chips, dots and the Team fact.
 */
describe('genderPill', () => {
  it.each([
    ['Women', "Women's", 'bg-category-women-soft text-category-women'],
    ['Girls', 'Girls', 'bg-category-women-soft text-category-women'],
    ['Men', "Men's", 'bg-category-men-soft text-category-men'],
    ['Boys', 'Boys', 'bg-category-men-soft text-category-men'],
    ['Mixed', 'Mixed', 'bg-category-mixed-soft text-category-mixed'],
  ])('%s → %s in its own category colour', (g, label, className) => {
    expect(genderPill(g)).toEqual({ label, className })
  })
  it('never uses raw hex, pink or blue utility classes', () => {
    for (const g of ['Women', 'Men', 'Mixed']) expect(categoryTagClass(g)).not.toMatch(/#|pink|blue|sky/)
    for (const c of Object.values(CATEGORY_DOT_CLASSES)) expect(c).not.toMatch(/#|pink|blue|sky/)
  })
  it('unknown or empty → null', () => {
    expect(genderPill(null)).toBeNull()
    expect(genderPill('Other')).toBeNull()
    expect(categoryFamily(undefined)).toBeNull()
  })
})
