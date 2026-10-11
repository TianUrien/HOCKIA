import { describe, expect, it } from 'vitest'
import { squirclePath } from '@/lib/squircle'
import { easedScrim } from '@/lib/communityCard'

describe('squircle path (finish pass)', () => {
  it('draws four smoothed corners for a uniform radius', () => {
    const d = squirclePath(361, 196, { tl: 24, tr: 24, br: 24, bl: 24 })
    expect(d.startsWith('M ')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d.match(/ a /g)?.length).toBe(4)
    // Smoothing 0.6 starts the curve 1.6 × r from the corner.
    expect(d.startsWith(`M ${361 - 24 * 1.6} 0`)).toBe(true)
  })

  it('keeps square corners where the radius is 0 (sheet / panel bottoms)', () => {
    const d = squirclePath(393, 400, { tl: 28, tr: 28, br: 0, bl: 0 })
    expect(d.match(/ a /g)?.length).toBe(2)
    expect(d).toContain('L 393 400')
    expect(d).toContain('L 0 400')
  })

  it('never borrows more than half the side', () => {
    const d = squirclePath(40, 40, { tl: 30, tr: 30, br: 30, bl: 30 })
    expect(d).not.toContain('NaN')
  })
})

describe('eased scrim', () => {
  it('7 stops from clear to the end alpha, eased', () => {
    const stops = easedScrim(40, 100, 0, 0.82)
    expect(stops).toHaveLength(7)
    expect(stops[0]).toBe('rgba(15, 15, 20, 0.000) 40.0%')
    expect(stops[6]).toBe('rgba(15, 15, 20, 0.820) 100.0%')
    expect(stops[3]).toBe('rgba(15, 15, 20, 0.410) 70.0%')
  })
})
