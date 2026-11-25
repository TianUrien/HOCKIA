/**
 * Player profile, design review 2026-11-24 (founder asked for the five fixes).
 * Source checks: the page itself needs a full data mock, so these guard the
 * decisions that are easy to undo by accident.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')
const page = read('components/profile/v2/PlayerProfileV2.tsx')

describe('player profile polish', () => {
  it('the videos row goes back to the start when its tiles arrive, unless the member moved it', () => {
    expect(page).toContain('data-testid="profile-video-rail"')
    expect(page).toContain('if (!videoRailTouched.current && videoRailRef.current) videoRailRef.current.scrollLeft = 0')
    expect(page).toContain('[overflow-anchor:none]')
  })

  it('linked videos use the shared tile, never the dark gradient with a lone icon', () => {
    expect(page).not.toContain('bg-gradient-to-br from-ink-1 to-ink-2')
    expect(page.match(/<LinkedVideoTile href=/g)?.length).toBe(2)
  })

  it('a reference quote is at reading size and regular weight', () => {
    const quote = page.slice(page.indexOf('r.endorsementText && <p'), page.indexOf('r.endorsementText && <p') + 120)
    expect(quote).toContain('text-row')
    expect(quote).not.toContain('font-semibold')
  })

  it('career dates sit under the club name, which may wrap instead of being cut', () => {
    const row = page.slice(page.indexOf('data-testid="career-row"'), page.indexOf('data-testid="career-row"') + 900)
    expect(row).toContain('line-clamp-2')
    expect(row).toContain('data-testid="career-row-dates"')
    expect(row).not.toContain('shrink-0 text-secondary font-semibold')
  })

  it('a full-width fact tile wraps its value to two lines', () => {
    expect(read('components/profile/v2/ProfileSections.tsx')).toContain("full ? 'line-clamp-2 break-words' : 'truncate'")
  })
})
