import { describe, expect, it } from 'vitest'
import { instagramHandleOf, normalizeInstagram } from '@/lib/brandEdit'

describe('normalizeInstagram', () => {
  it('turns handles and links into one instagram.com link', () => {
    expect(normalizeInstagram('@grays')).toEqual({ url: 'https://instagram.com/grays', error: null })
    expect(normalizeInstagram('grays.official')).toEqual({ url: 'https://instagram.com/grays.official', error: null })
    expect(normalizeInstagram('instagram.com/grays')).toEqual({ url: 'https://instagram.com/grays', error: null })
    expect(normalizeInstagram('https://www.instagram.com/grays/?igsh=abc')).toEqual({ url: 'https://instagram.com/grays', error: null })
  })
  it('clears on empty and rejects websites or junk', () => {
    expect(normalizeInstagram('  ')).toEqual({ url: '', error: null })
    expect(normalizeInstagram('https://grays.com').error).not.toBeNull()
    expect(normalizeInstagram('not a handle').error).not.toBeNull()
  })
  it('reads the handle back from what is stored', () => {
    expect(instagramHandleOf('https://instagram.com/grays')).toBe('grays')
    expect(instagramHandleOf('@grays')).toBe('grays')
    expect(instagramHandleOf('https://grays.com')).toBeNull()
    expect(instagramHandleOf(null)).toBeNull()
  })
})
