/**
 * Recruiter verdict synthesis (Matching Increment #5, deterministic half).
 *
 * Contract:
 *   - NOT_APPLICABLE unless Fit is applicable (mirrors the recruiter gate).
 *   - Action tiers (Pursue / Worth considering / Longshot / Likely pass)
 *     fuse Fit (spine) + Proven (support) + Interested (real weight, low =
 *     negative). Scores stay internal; only the tier is exposed.
 *   - Highlights pull positive lens reasons (fit→proven→interested);
 *     caveats pull concerns (low interest → grey fit → thin evidence).
 */

import { describe, expect, it } from 'vitest'
import { computeRecruiterVerdict } from '@/lib/recruiterVerdict'

const fit = (state: 'green' | 'yellow' | 'grey', reasons: string[] = [`fit:${state}`], isApplicable = true) => ({
  isApplicable,
  state,
  reasons,
})
const evidence = (level: 'strong' | 'moderate' | 'limited', reasons: string[] = [`ev:${level}`], isApplicable = true) => ({
  isApplicable,
  level,
  reasons,
})
const interest = (level: 'strong' | 'possible' | 'low', reasons: string[] = [`int:${level}`], isApplicable = true) => ({
  isApplicable,
  level,
  reasons,
})

describe('computeRecruiterVerdict', () => {
  it('NOT_APPLICABLE when fit is null', () => {
    const r = computeRecruiterVerdict({ fit: null, evidence: evidence('strong'), interest: interest('strong') })
    expect(r.isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when fit is not applicable', () => {
    const r = computeRecruiterVerdict({ fit: fit('green', ['x'], false), evidence: null, interest: null })
    expect(r.isApplicable).toBe(false)
  })

  it('green fit + strong proven + strong interest → Pursue', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green'),
      evidence: evidence('strong'),
      interest: interest('strong'),
    })
    expect(r.tier).toBe('pursue')
    expect(r.headline).toBe('Pursue')
    expect(r.highlights.length).toBeGreaterThanOrEqual(3)
    expect(r.caveats).toEqual([])
  })

  it('green fit alone (no proven/interest) → Worth considering (not Pursue without support)', () => {
    const r = computeRecruiterVerdict({ fit: fit('green'), evidence: null, interest: null })
    // 2.0 points — above 1.4 (consider) but below 2.6 (pursue).
    expect(r.tier).toBe('consider')
    expect(r.highlights[0]).toBe('fit:green')
  })

  it('possible fit alone → Longshot', () => {
    const r = computeRecruiterVerdict({ fit: fit('yellow'), evidence: null, interest: null })
    // 1.0 points — above 0.4 (longshot) but below 1.4 (consider).
    expect(r.tier).toBe('longshot')
  })

  it('low interest drags a green fit down out of Pursue and surfaces as a caveat', () => {
    const strong = computeRecruiterVerdict({ fit: fit('green'), evidence: evidence('strong'), interest: interest('strong') })
    const dragged = computeRecruiterVerdict({
      fit: fit('green'),
      evidence: null,
      interest: interest('low', ['Wants paid; this is a development role.']),
    })
    expect(strong.tier).toBe('pursue')
    // green(2) + low(−0.8) = 1.2 → longshot, not pursue.
    expect(dragged.tier).toBe('longshot')
    expect(dragged.caveats).toContain('Wants paid; this is a development role.')
  })

  it('grey fit can never be Pursue/Worth considering — capped at Longshot', () => {
    const r = computeRecruiterVerdict({
      fit: fit('grey', ['Different level from your team.']),
      evidence: evidence('strong'),
      interest: interest('strong'),
    })
    // Raw points (0 + 1.2 + 1.6 = 2.8) clear the pursue threshold, but the
    // grey-fit cap pulls it back: doesn't fit → at best a longshot.
    expect(r.tier).toBe('longshot')
  })

  it('mediocre fit + active mismatch → Likely pass', () => {
    const r = computeRecruiterVerdict({
      fit: fit('yellow', ['Close on level.']),
      evidence: null,
      interest: interest('low', ['Excluded that country.']),
    })
    // yellow(1) + low(−0.8) = 0.2 → below 0.4 → pass.
    expect(r.tier).toBe('pass')
    expect(r.headline).toBe('Likely pass')
    expect(r.caveats[0]).toBe('Excluded that country.')
  })

  it('grey fit alone → Likely pass, fit reason as a caveat', () => {
    const r = computeRecruiterVerdict({
      fit: fit('grey', ['Different level from your team.']),
      evidence: evidence('limited'),
      interest: interest('low', ['Excluded that country.']),
    })
    expect(r.tier).toBe('pass')
    // Low interest is the sharpest caveat, listed first; grey fit follows.
    expect(r.caveats[0]).toBe('Excluded that country.')
    expect(r.caveats).toContain('Different level from your team.')
  })

  it('ignores non-applicable proven/interest in both scoring and reasons', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green', ['Right level.']),
      evidence: evidence('strong', ['has video'], false),
      interest: interest('strong', ['open'], false),
    })
    // Only fit counts → 2.0 → Worth considering; no proven/interest reasons.
    expect(r.tier).toBe('consider')
    expect(r.highlights).toEqual(['Right level.'])
  })

  it('caps highlights at 3 and caveats at 2', () => {
    const r = computeRecruiterVerdict({
      fit: fit('green', ['f1', 'f2']),
      evidence: evidence('strong', ['e1']),
      interest: interest('strong', ['i1']),
    })
    expect(r.highlights.length).toBeLessThanOrEqual(3)
    expect(r.caveats.length).toBeLessThanOrEqual(2)
  })

  it('limited evidence appears as a caveat when nothing sharper outranks it', () => {
    const r = computeRecruiterVerdict({
      fit: fit('yellow', ['Close on level.']),
      evidence: evidence('limited', ['Little evidence on file.']),
      interest: interest('possible', ['Open to discuss.']),
    })
    expect(r.caveats).toContain('Little evidence on file.')
  })
})
