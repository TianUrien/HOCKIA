import { describe, it, expect } from 'vitest'
import { checkContent } from '@/lib/contentFilter'

describe('contentFilter', () => {
  describe('checkContent', () => {
    it('allows normal text', () => {
      expect(checkContent('Great game today!')).toEqual({ allowed: true })
    })

    it('allows empty text', () => {
      expect(checkContent('')).toEqual({ allowed: true })
    })

    it('allows hockey-related content', () => {
      expect(checkContent('Looking for a midfielder for our club')).toEqual({ allowed: true })
    })

    it('allows constructive criticism', () => {
      expect(checkContent('The defense needs improvement. Spacing was off in the second half.')).toEqual({ allowed: true })
    })

    it('blocks severe hate speech', () => {
      const result = checkContent('you are a n1gger')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('blocks homophobic slurs', () => {
      const result = checkContent('what a faggot')
      expect(result.allowed).toBe(false)
    })

    it('blocks death threats', () => {
      const result = checkContent('kill yourself')
      expect(result.allowed).toBe(false)
    })

    it('blocks threat variations', () => {
      const result = checkContent('go die loser')
      expect(result.allowed).toBe(false)
    })

    it('blocks case-insensitive slurs', () => {
      const result = checkContent('YOU ARE A NIGGER')
      expect(result.allowed).toBe(false)
    })

    it('returns a user-friendly reason when blocked', () => {
      const result = checkContent('kill yourself now')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('community guidelines')
    })
  })
})
