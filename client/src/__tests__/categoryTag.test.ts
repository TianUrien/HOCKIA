import { describe, expect, it } from 'vitest'
import { CATEGORY_TAG_CLASS, genderPill } from '@/lib/opportunityCopy'

/** Founder ruling 2026-10-04: one soft-purple Tag style for every team / category. */
describe('genderPill', () => {
  it.each([
    ['Women', "Women's"], ['Men', "Men's"], ['Girls', 'Girls'], ['Boys', 'Boys'], ['Mixed', 'Mixed'],
  ])('%s → %s in soft purple', (g, label) => {
    expect(genderPill(g)).toEqual({ label, className: 'bg-brand-soft text-brand-primary' })
  })
  it('uses no pink or blue', () => {
    expect(CATEGORY_TAG_CLASS).not.toMatch(/#|pink|blue|sky/)
  })
  it('unknown or empty → null', () => {
    expect(genderPill(null)).toBeNull()
    expect(genderPill('Other')).toBeNull()
  })
})
