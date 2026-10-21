/** Batch C (2026-10-21): one initials rule app-wide, letters only. */
import { describe, expect, it } from 'vitest'
import { getInitials } from '@/lib/utils'
import { initialsOf } from '@/lib/communityCard'

describe('getInitials / initialsOf', () => {
  it.each([
    ['[QA] iOS Layout', 'IL'],
    ['[QA] Safe Area', 'SA'],
    ['QA Test Club 03', 'QC'],
    ['Ana María López', 'AL'],
    ['Tomás', 'T'],
    ['  élodie   ', 'É'],
    ['(Staging) Hockey Club Bologna', 'HB'],
    ['03 #1', '?'],
    ['', '?'],
    [null, '?'],
  ] as const)('%s → %s', (name, expected) => {
    expect(getInitials(name)).toBe(expected)
    expect(initialsOf(name)).toBe(expected)
  })
  it('a name that is only a tag keeps its letters', () => {
    expect(getInitials('[QA]')).toBe('Q')
  })
})
