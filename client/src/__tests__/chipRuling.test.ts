import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { CHIP_SELECTED, CHIP_UNSELECTED, chipTone } from '@/components/ui/chipClasses'

/**
 * Chip ruling 2026-10-04/05: a selected chip is soft purple, never black or
 * solid violet. Design audit 2026-10-21 A4: unselected = outline on white
 * (no grey fill), everywhere a chip, tab or section anchor shows a selection.
 */
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
    expect(s).toMatch(/bg-brand-soft text-brand-primary|<Chip |chipTone\(/)
  })
  it('Community segments: soft purple on every breakpoint (no solid black on desktop)', () => {
    const s = src('components/community/CommunitySegments.tsx')
    expect(s).toContain('chipTone(active)')
    expect(s).not.toContain('lg:bg-ink-1')
  })
})

describe('shared chip tones (audit A4)', () => {
  it('selected = brand soft fill + brand primary text; unselected = outline on white', () => {
    expect(chipTone(true)).toBe(CHIP_SELECTED)
    expect(CHIP_SELECTED).toContain('bg-brand-soft')
    expect(CHIP_SELECTED).toContain('text-brand-primary')
    expect(chipTone(false)).toBe(CHIP_UNSELECTED)
    expect(CHIP_UNSELECTED).toContain('border-line')
    expect(CHIP_UNSELECTED).toContain('bg-white')
    expect(CHIP_UNSELECTED).not.toMatch(/bg-surface|bg-gray/)
  })

  it.each([
    'components/ui/Chip.tsx',
    'components/profile/v2/ProfileChrome.tsx',
    'components/home/PostComposerModal.tsx',
    'components/community/CommunitySegments.tsx',
    'components/search/SearchOverlay.tsx',
    'components/profile/PublicConnectionsPage.tsx',
    'components/profile/PortfolioSectionNav.tsx',
    'pages/SearchPage.tsx',
    'components/club/FindPlayersScreen.tsx',
    'components/club/roleFormUi.tsx',
  ])('%s uses the shared tones, never solid black or solid violet', (f) => {
    const s = src(f)
    expect(s).toContain('chipTone(')
    expect(s).not.toMatch(/\? 'bg-ink-1 text-white'|active === item\.id \? 'bg-ink-1/)
    expect(s).not.toMatch(/\? 'bg-hockia-primary text-white'/)
  })

  it.each(['pages/WorldProvincePage.tsx', 'pages/WorldCountryPage.tsx'])('%s segment is soft, not solid violet', (f) => {
    const s = src(f)
    expect(s).not.toContain("'bg-hockia-primary text-white shadow-sm'")
    expect(s).toContain("'bg-brand-soft text-brand-primary'")
  })
})
