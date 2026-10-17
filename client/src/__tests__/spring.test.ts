import { afterEach, describe, expect, it, vi } from 'vitest'
import { cssSpring, prefersReducedMotion, springValue, animateSpring } from '@/lib/spring'

describe('spring', () => {
  it('cssSpring samples a linear() easing that starts at 0 and settles near 1', () => {
    const e = cssSpring(0.42, 0.7)
    expect(e.startsWith('linear(0.000,')).toBe(true)
    const pts = e.slice(7, -1).split(',').map(Number)
    expect(pts).toHaveLength(41)
    expect(Math.abs(pts[pts.length - 1] - 1)).toBeLessThan(0.05)
    expect(Math.max(...pts)).toBeGreaterThan(1) // under-damped: a small overshoot
  })
  afterEach(() => vi.unstubAllGlobals())
  it('with Reduce Motion a spring lands instantly (callers crossfade with CSS)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const seen: number[] = []
    const s = springValue(1, (x) => seen.push(x))
    animateSpring(s, 0.96)
    expect(s.x).toBe(0.96)
    expect(seen).toEqual([0.96])
    expect(typeof prefersReducedMotion()).toBe('boolean')
  })
})
