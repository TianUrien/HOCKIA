/**
 * A centred spinner (`-translate-x-1/2 -translate-y-1/2 animate-spin`) must
 * stay centred while it turns. Tailwind's stock `spin` keyframes animate
 * `transform: rotate()`, which drops the translate and makes the circle jump
 * out of place (founder report 2026-11-23, the Reload button of the update
 * banner). Our keyframes keep the element's translate.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error the Tailwind config is plain JS, without types
import config from '../../tailwind.config.js'

describe('spin animation', () => {
  it('rotates on top of the element\'s own translate', () => {
    const spin = (config as { theme: { extend: { keyframes: Record<string, Record<string, { transform: string }>> } } }).theme.extend.keyframes.spin
    for (const step of [spin.from, spin.to]) {
      expect(step.transform).toContain('translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0))')
    }
    expect(spin.from.transform).toContain('rotate(0deg)')
    expect(spin.to.transform).toContain('rotate(360deg)')
  })
})
