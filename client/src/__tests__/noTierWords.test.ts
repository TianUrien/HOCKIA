/**
 * Founder decision 2026-10-21: no completeness tier words about a profile
 * ("Strong profile", "Looking good", "Getting there", "Just started", "All
 * set") anywhere in the app. Viewers see nothing; owners see the next missing
 * item and recruiters a "Missing: …" line (audit A2).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const TIER_WORDS = /['">`](Strong profile|Looking good|Getting there|Just started|All set)['"<`]/

describe('no profile tier words', () => {
  it('no source renders a tier word as copy', () => {
    const offenders = walk(SRC).filter((p) => TIER_WORDS.test(readFileSync(p, 'utf8')))
    expect(offenders.map((p) => p.replace(SRC, ''))).toEqual([])
  })

  it('the TierBadge component and its barrel export are gone', () => {
    expect(existsSync(join(SRC, 'components/TierBadge.tsx'))).toBe(false)
    expect(readFileSync(join(SRC, 'components/index.ts'), 'utf8')).not.toContain('TierBadge')
    for (const rel of ['components/community/MemberPreviewModal.tsx', 'components/dashboard/bento/ClubHeroCard.tsx', 'pages/BrandDashboard.tsx', 'pages/UmpireDashboard.tsx', 'components/MemberCard.tsx', 'components/MemberTile.tsx']) {
      expect(readFileSync(join(SRC, rel), 'utf8')).not.toContain('TierBadge')
    }
  })
})
