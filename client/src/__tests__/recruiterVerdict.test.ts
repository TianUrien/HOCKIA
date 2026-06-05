/**
 * Recruiter verdict synthesis (Matching Increment #5, deterministic half).
 *
 * Contract:
 *   - NOT_APPLICABLE unless Fit is applicable (mirrors the recruiter gate).
 *   - Action tiers (Pursue / Worth considering / Longshot / Likely pass)
 *     fuse Fit (spine) + Proven (support) + Interested (real weight, low =
 *     negative). Scores stay internal; only the tier is exposed.
 *   - Highlights pull each lens's POSITIVES (fit→proven→interested);
 *     caveats pull CAVEATS (interest → fit → thin evidence). Polarity comes
 *     from the lens tags, never inferred from the overall level.
 */

import { describe, expect, it } from 'vitest'
import { computeRecruiterVerdict } from '@/lib/recruiterVerdict'

const fit = (
  state: 'green' | 'yellow' | 'grey',
  { positives = [], caveats = [], isApplicable = true }: { positives?: string[]; caveats?: string[]; isApplicable?: boolean } = {},
) => ({ isApplicable, state, positives, caveats })

const evidence = (
  level: 'strong' | 'moderate' | 'limited',
  { reasons = [`ev:${level}`], isApplicable = true }: { reasons?: string[]; isApplicable?: boolean } = {},
) => ({ isApplicable, level, reasons })

const interest = (
  level: 'strong' | 'possible' | 'low',
  { positives = [], caveats = [], isApplicable = true }: { positives?: string[]; caveats?: string[]; isApplicable?: boolean } = {},
) => ({ isApplicable, level, positives, caveats })

describe('computeRecruiterVerdict', () => {
  it('NOT_APPLICABLE when fit is null', () => {
    const r = computeRecruiterVerdict({ fit: null, evidence: evidence('strong'), interest: interest('strong') })
    expect(r.isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when fit is not applicable', () => {
    const r = computeRecruiterVerdict({ fit: fit('green', { isApplicable: false }), evidence: null, interest: null })
    expect(r.isApplicable).toBe(false)
  })

  it('green fit + strong proven + strong interest → Pursue, highlights from positives only', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green', { positives: ['Plays Adult Men — matches your team category.'] }),
      evidence: evidence('strong', { reasons: ['Full match footage available.'] }),
      interest: interest('strong', { positives: ['Open to relocating.'] }),
    })
    expect(r.tier).toBe('pursue')
    expect(r.headline).toBe('Pursue')
    expect(r.highlights).toEqual([
      'Plays Adult Men — matches your team category.',
      'Full match footage available.',
      'Open to relocating.',
    ])
    expect(r.caveats).toEqual([])
  })

  it('green fit alone → Worth considering (not Pursue without support)', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green', { positives: ['Right level.'] }),
      evidence: null,
      interest: null,
    })
    expect(r.tier).toBe('consider')
    expect(r.highlights).toEqual(['Right level.'])
  })

  it('possible fit alone → Longshot', () => {
    const r = computeRecruiterVerdict({ fit: fit('yellow', { positives: ['Open recently.'] }), evidence: null, interest: null })
    expect(r.tier).toBe('longshot')
  })

  it('low interest drags a green fit out of Pursue and its caveat surfaces (not as a highlight)', () => {
    const dragged = computeRecruiterVerdict({
      fit: fit('green', { positives: ['Right level.'] }),
      evidence: null,
      interest: interest('low', { caveats: ['Wants paid; this is a development role.'] }),
    })
    expect(dragged.tier).toBe('longshot') // green(2) + low(−0.8) = 1.2
    expect(dragged.caveats).toContain('Wants paid; this is a development role.')
    expect(dragged.highlights).not.toContain('Wants paid; this is a development role.')
  })

  it('grey fit (category mismatch) can never be Pursue/Worth considering — capped at Longshot', () => {
    const r = computeRecruiterVerdict({
      fit: fit('grey', { caveats: ['Plays Adult Women — different from your team category.'] }),
      evidence: evidence('strong', { reasons: ['Full match footage available.'] }),
      interest: interest('strong', { positives: ['Open to relocating.'] }),
    })
    // Raw points (0 + 1.2 + 1.6 = 2.8) clear pursue, but the grey cap pulls
    // it back: doesn't fit → at best a longshot.
    expect(r.tier).toBe('longshot')
    expect(r.caveats).toContain('Plays Adult Women — different from your team category.')
  })

  it('mediocre fit + active mismatch → Likely pass, interest caveat listed first', () => {
    const r = computeRecruiterVerdict({
      fit: fit('yellow', { positives: ['Close on level.'], caveats: ['Different league level.'] }),
      evidence: null,
      interest: interest('low', { caveats: ['Excluded that country.'] }),
    })
    expect(r.tier).toBe('pass') // yellow(1) + low(−0.8) = 0.2
    expect(r.headline).toBe('Likely pass')
    expect(r.caveats[0]).toBe('Excluded that country.')
  })

  it('thin evidence becomes a synthesized caveat, never a positive evidence line as a caveat', () => {
    const r = computeRecruiterVerdict({
      fit: fit('yellow', { positives: ['Close on level.'] }),
      evidence: evidence('limited', { reasons: ['Plays at a listed club & league (provable level).'] }),
      interest: null,
    })
    // The positive evidence sentence must NOT appear as a caveat (the bug),
    // and limited evidence yields a synthesized concern instead.
    expect(r.caveats).not.toContain('Plays at a listed club & league (provable level).')
    expect(r.caveats).toContain('Limited video & references on file so far.')
    // Limited evidence is too thin to be a selling point → not a highlight.
    expect(r.highlights).not.toContain('Plays at a listed club & league (provable level).')
  })

  it('over-qualification note (interest caveat) is a caveat, not a highlight', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green', { positives: ['Right level.'] }),
      evidence: null,
      interest: interest('possible', { caveats: ["Below the level they've proven."] }),
    })
    expect(r.caveats).toContain("Below the level they've proven.")
    expect(r.highlights).not.toContain("Below the level they've proven.")
  })

  it('caps highlights at 3 and caveats at 2', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green', { positives: ['f1', 'f2'], caveats: ['c1'] }),
      evidence: evidence('strong', { reasons: ['e1'] }),
      interest: interest('low', { caveats: ['i1', 'i2'] }),
    })
    expect(r.highlights.length).toBeLessThanOrEqual(3)
    expect(r.caveats.length).toBeLessThanOrEqual(2)
  })

  it('scoped flag passes through for the for-your-scope vs general-fit label', () => {
    const scoped = computeRecruiterVerdict({ fit: fit('green', { positives: ['x'] }), evidence: null, interest: null, hasOpeningScope: true })
    const general = computeRecruiterVerdict({ fit: fit('green', { positives: ['x'] }), evidence: null, interest: null })
    expect(scoped.scoped).toBe(true)
    expect(general.scoped).toBe(false)
  })
})

// ── Increment #6 — recruitment-problem re-weighting ─────────────────
describe('computeRecruiterVerdict — problem re-weighting (#6)', () => {
  it('unknown / no problem → balanced default + weightedFor null', () => {
    const r = computeRecruiterVerdict({ fit: fit('green', { positives: ['x'] }), evidence: null, interest: null })
    expect(r.weightedFor).toBeNull()
    const unknown = computeRecruiterVerdict({ fit: fit('green', { positives: ['x'] }), evidence: null, interest: null, problem: 'nonsense' })
    expect(unknown.weightedFor).toBeNull() // unrecognised → no label, default weights
  })

  it('weightedFor carries the human problem label', () => {
    const r = computeRecruiterVerdict({ fit: fit('green', { positives: ['x'] }), evidence: null, interest: null, problem: 'urgent' })
    expect(r.weightedFor).toBe('Urgent need')
  })

  it('a high-interest / low-proven player ranks higher under "Urgent" than under "Raise team level"', () => {
    // Lopsided candidate: only a yellow fit + thin evidence, but strongly
    // interested + available. Urgent (interest-heavy) should value them far
    // more than Raise-level (proven-heavy).
    const candidate = {
      fit: fit('yellow', { positives: ['Close on level.'] }),
      evidence: evidence('limited'),
      interest: interest('strong', { positives: ['Open to relocating and available now.'] }),
    }
    const urgent = computeRecruiterVerdict({ ...candidate, problem: 'urgent' })
    const raise = computeRecruiterVerdict({ ...candidate, problem: 'raise_level' })
    const rank = { pass: 0, longshot: 1, consider: 2, pursue: 3 }
    expect(rank[urgent.tier]).toBeGreaterThan(rank[raise.tier])
    // …and Urgent leads the explanation with the interest selling point.
    expect(urgent.highlights[0]).toBe('Open to relocating and available now.')
  })

  it('"Raise team level" rewards a strong-fit player and leads with the fit highlight', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green', { positives: ['Plays at a comparable league level to your team.'] }),
      evidence: evidence('limited'),
      interest: interest('possible', { positives: ['Open to discuss.'] }),
      problem: 'raise_level',
    })
    // fit-led order (level lives in fit), and a thin video file no longer
    // sinks a level-appropriate player the way the old proven-heavy profile did.
    expect(r.highlights[0]).toBe('Plays at a comparable league level to your team.')
    expect(r.weightedFor).toBe('Raise team level')
    expect(['pursue', 'consider']).toContain(r.tier)
  })

  it('"Young talent" does not punish thin proven the way the default would', () => {
    const candidate = {
      fit: fit('green', { positives: ['Right category.'] }),
      evidence: evidence('limited'),
      interest: interest('strong', { positives: ['Keen and available.'] }),
    }
    const dflt = computeRecruiterVerdict(candidate)
    const young = computeRecruiterVerdict({ ...candidate, problem: 'young_talent' })
    const rank = { pass: 0, longshot: 1, consider: 2, pursue: 3 }
    expect(rank[young.tier]).toBeGreaterThanOrEqual(rank[dflt.tier])
  })

  it('grey-fit cap still holds regardless of problem weighting', () => {
    const r = computeRecruiterVerdict({
      fit: fit('grey', { caveats: ['Different category.'] }),
      evidence: evidence('strong'),
      interest: interest('strong', { positives: ['Keen.'] }),
      problem: 'urgent',
    })
    expect(['longshot', 'pass']).toContain(r.tier) // never pursue/consider
  })
})
