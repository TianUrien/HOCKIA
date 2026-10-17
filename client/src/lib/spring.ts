/**
 * Springs for Opportunities v2 motion (Figma "OP · Motion spec", approved
 * prototype 2026-10-16). Apple-style: a spring is defined by RESPONSE (s) and
 * DAMPING ratio, never a duration. Springs are interruptible: retargeting
 * keeps the current value and velocity. No library (480 KB first-load
 * budget); ~40 lines ported from the prototype's solver.
 *
 * Reduce Motion: every spring lands instantly; callers crossfade with CSS.
 */

export interface SpringOptions {
  response?: number
  damping?: number
  /** Initial velocity handed over from a gesture (units per second). */
  v?: number
  onDone?: () => void
}

export interface SpringValue {
  x: number
  v: number
  target: number
  response: number
  damping: number
  onUpdate: (x: number) => void
  onDone: (() => void) | null
}

export const SPRING = {
  press: { response: 0.28, damping: 0.9 },
  release: { response: 0.45, damping: 0.62 },
  sheetOpen: { response: 0.48, damping: 0.86 },
  sheetClose: { response: 0.42, damping: 1.0 },
  send: { response: 0.42, damping: 0.7 },
  default: { response: 0.42, damping: 0.82 },
} as const

export const PRESS_SCALE = 0.96

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

const active = new Set<SpringValue>()
let raf = 0
let last = 0

function tick(t: number): void {
  const dt = Math.min(0.034, (t - last) / 1000 || 0.016)
  last = t
  for (const s of [...active]) {
    const k = Math.pow((2 * Math.PI) / s.response, 2)
    const c = (4 * Math.PI * s.damping) / s.response
    const n = 4
    const h = dt / n
    for (let i = 0; i < n; i++) {
      const a = -k * (s.x - s.target) - c * s.v
      s.v += a * h
      s.x += s.v * h
    }
    if (Math.abs(s.x - s.target) < 5e-4 && Math.abs(s.v) < 5e-3) {
      s.x = s.target
      s.v = 0
      active.delete(s)
      s.onUpdate(s.x)
      s.onDone?.()
      continue
    }
    s.onUpdate(s.x)
  }
  raf = active.size ? requestAnimationFrame(tick) : 0
}

/** Create a spring value at `x`; `onUpdate` receives every frame. */
export function springValue(x: number, onUpdate: (x: number) => void): SpringValue {
  return { x, v: 0, target: x, response: SPRING.default.response, damping: SPRING.default.damping, onUpdate, onDone: null }
}

/** Retarget a spring (interruptible: keeps the current value and velocity). */
export function animateSpring(s: SpringValue, target: number, opts: SpringOptions = {}): void {
  s.target = target
  s.response = opts.response ?? SPRING.default.response
  s.damping = opts.damping ?? SPRING.default.damping
  if (opts.v !== undefined) s.v = opts.v
  s.onDone = opts.onDone ?? null
  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    s.x = target
    s.v = 0
    active.delete(s)
    s.onUpdate(target)
    s.onDone?.()
    return
  }
  active.add(s)
  if (!raf) {
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
}

/** Stop a spring where it is (unmount). */
export function stopSpring(s: SpringValue): void {
  active.delete(s)
  if (active.size === 0 && raf) { cancelAnimationFrame(raf); raf = 0 }
}

/**
 * CSS `linear()` easing sampled from the same solver, for small UI
 * transitions (chips, segmented thumb, sheet). Returns null when the browser
 * has no linear() support (then CSS falls back to its own easing).
 */
export function cssSpring(response: number, damping: number): string {
  let x = 0
  let v = 0
  const k = Math.pow((2 * Math.PI) / response, 2)
  const c = (4 * Math.PI * damping) / response
  const pts: string[] = []
  const T = response * 2.2
  const N = 40
  for (let i = 0; i <= N; i++) {
    pts.push(x.toFixed(3))
    for (let j = 0; j < 10; j++) {
      const h = T / N / 10
      const a = -k * (x - 1) - c * v
      v += a * h
      x += v * h
    }
  }
  return `linear(${pts.join(',')})`
}

/** Sets `--spring` (easing) and `--spring-ms` on <html> once; idempotent. */
export function installSpringEasing(): void {
  if (typeof document === 'undefined' || typeof CSS === 'undefined') return
  const root = document.documentElement
  if (root.style.getPropertyValue('--spring')) return
  if (CSS.supports?.('transition-timing-function', 'linear(0,1)')) {
    root.style.setProperty('--spring', cssSpring(SPRING.default.response, Math.max(0.55, SPRING.default.damping - 0.12)))
  } else {
    root.style.setProperty('--spring', 'cubic-bezier(0.2, 0.8, 0.2, 1)')
  }
  root.style.setProperty('--spring-ms', `${Math.round(SPRING.default.response * 2200)}ms`)
}
