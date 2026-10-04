import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

/** Chip ruling 2026-10-04: a selected chip is soft purple, never black. */
const src = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8')

describe('selected chips are soft purple', () => {
  it.each([
    'components/community/CommunityFiltersDrawer.tsx',
    'components/club/ShortlistScreen.tsx',
    'components/club/FindPlayersScreen.tsx',
    'components/club/DeclineSheet.tsx',
    'components/club/ApplicantsScreen.tsx',
  ])('%s', (f) => {
    const s = src(f)
    expect(s).not.toContain("'bg-ink-1 text-white'")
    expect(s).toMatch(/bg-brand-soft text-brand-primary|<Chip /)
  })
  it('Community segments: soft purple on the phone', () => {
    expect(src('components/community/CommunitySegments.tsx')).toContain("active ? 'bg-brand-soft text-brand-primary")
  })
})
