import { useEffect, useRef, useState } from 'react'

/**
 * Motion primitives for the marketing surface.
 *
 * Why a shared module rather than per-component effects: a page feels premium
 * when everything moves with the SAME language. Scattered ad-hoc durations and
 * easings read as a page assembled by several people. One token set, applied
 * everywhere, is most of the difference.
 *
 * PERFORMANCE CONTRACT — every animation here touches only `transform`,
 * `opacity`, or a CSS custom property. Nothing animates a layout property, so
 * nothing triggers reflow mid-scroll.
 *
 * Scroll work is consolidated: ONE listener and ONE rAF pump for the whole
 * page, with subscribers pulled from a Set. The previous implementation added
 * a scroll listener per revealing element (~30 on this page), each doing its
 * own getBoundingClientRect during the scroll handler.
 *
 * ACCESSIBILITY — `prefers-reduced-motion` collapses everything to its final
 * state instantly. It is honoured reactively: someone toggling the OS setting
 * with the page open gets the new behaviour without a reload.
 */

/** Entrance: expo-out. Fast departure, long settle — reads as momentum. */
export const EASE_ENTRANCE = 'cubic-bezier(0.16, 1, 0.3, 1)'
/** Hover/press: slight overshoot. Only for small, fast, interruptible moves. */
export const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
/** Colour, shadow, opacity — no overshoot, it looks wrong on non-spatial props. */
export const EASE_GLIDE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export const DUR_ENTRANCE = 620
export const DUR_HOVER = 240

/** Base gap between staggered siblings. */
const STAGGER_MS = 70
/** Beyond this the wait stops feeling choreographed and starts feeling slow. */
const STAGGER_CAP = 6

/** Stagger delay for index `i`, capped so long lists never drag. */
export function stagger(i: number, base = STAGGER_MS): number {
  return Math.min(i, STAGGER_CAP) * base
}

// ── Reduced motion ──────────────────────────────────────────────────────────

const RM_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(RM_QUERY).matches
  } catch {
    return false
  }
}

/** Reactive: responds to the OS setting changing while the page is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(RM_QUERY)
    const onChange = () => setReduced(mq.matches)
    setReduced(mq.matches)
    // Safari < 14 has no addEventListener on MediaQueryList.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [])

  return reduced
}

// ── One scroll listener for the whole page ──────────────────────────────────

type Sub = () => void
const subs = new Set<Sub>()
let frame = 0
let bound = false

function pump() {
  frame = 0
  for (const fn of subs) {
    try {
      fn()
    } catch {
      /* one bad subscriber must not stop the rest */
    }
  }
}

function schedule() {
  if (frame === 0) frame = requestAnimationFrame(pump)
}

/** Subscribe to rAF-throttled scroll/resize. Returns an unsubscribe fn. */
export function onScrollFrame(fn: Sub): () => void {
  subs.add(fn)
  if (!bound && typeof window !== 'undefined') {
    bound = true
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
  }
  fn() // prime, so the element is correct before the first scroll
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && bound) {
      bound = false
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }
  }
}

// ── Pooled IntersectionObservers ────────────────────────────────────────────
// One observer per distinct rootMargin, shared by every element using it,
// instead of one observer per component.

const pools = new Map<string, { io: IntersectionObserver; cbs: Map<Element, () => void> }>()

function observe(el: Element, margin: string, cb: () => void): () => void {
  let pool = pools.get(margin)
  if (!pool) {
    const cbs = new Map<Element, () => void>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) cbs.get(e.target)?.()
        }
      },
      { rootMargin: margin, threshold: 0 },
    )
    pool = { io, cbs }
    pools.set(margin, pool)
  }
  pool.cbs.set(el, cb)
  pool.io.observe(el)
  return () => {
    pool.cbs.delete(el)
    pool.io.unobserve(el)
  }
}

/**
 * True once the element has been near the viewport. Never flips back — this
 * drives entrances, and content that re-hides on scroll-up is a nuisance.
 *
 * SAFETY: marketing copy must never be permanently invisible. There are three
 * independent paths to visible — an immediate near-viewport check, the shared
 * observer, and an unconditional timeout — and any one is sufficient. (Caught
 * in review once: a full-page capture left two sections blank because the
 * observer never fired for them.)
 */
const FAILSAFE_MS = 1500

export function useInView<T extends HTMLElement>(margin = '0px 0px -8% 0px') {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    let done = false
    const show = () => {
      if (done) return
      done = true
      setInView(true)
    }

    const r = el.getBoundingClientRect()
    if (r.top < window.innerHeight * 1.15 && r.bottom > 0) show()

    const unobserve = observe(el, margin, show)
    const unsub = onScrollFrame(() => {
      if (done) return
      const b = el.getBoundingClientRect()
      if (b.top < window.innerHeight * 1.15 && b.bottom > 0) show()
    })
    const t = window.setTimeout(show, FAILSAFE_MS)

    return () => {
      unobserve()
      unsub()
      window.clearTimeout(t)
    }
  }, [margin, reduced])

  return { ref, inView }
}

// ── Parallax ────────────────────────────────────────────────────────────────

/**
 * Subtle scroll-linked drift. `range` is the TOTAL travel in px across the
 * element's full pass through the viewport — keep it small (16–32px). Parallax
 * stops reading as depth and starts reading as a bug somewhere past ~40px.
 *
 * Apply to a wrapper that owns no other transform: entrance animations also
 * write `transform`, and the last writer wins.
 */
export function useParallax<T extends HTMLElement>(range = 24) {
  const ref = useRef<T | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reduced || range === 0) return

    let last = NaN
    return onScrollFrame(() => {
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      // Skip offscreen elements entirely — no style writes, no compositing.
      if (r.bottom < -100 || r.top > vh + 100) return
      // -1 (entering from below) → 0 (centred) → 1 (leaving above)
      const p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2)
      const y = Math.max(-1, Math.min(1, p)) * (range / 2)
      const rounded = Math.round(y * 10) / 10
      if (rounded === last) return // no redundant style writes
      last = rounded
      el.style.transform = `translate3d(0, ${rounded}px, 0)`
    })
  }, [range, reduced])

  return ref
}

// ── Pointer glow ────────────────────────────────────────────────────────────

/**
 * Cursor-tracked lighting across a group of cards.
 *
 * The effect that sells it is the BLEED: light spilling from the hovered card
 * onto its neighbours, so a grid reads as one lit surface instead of six
 * separate boxes. That requires a single listener on the container writing
 * pointer-relative coordinates to every card, which is why this is a container
 * hook and not per-card hover state.
 *
 * Cost control: card rects are cached and only recomputed on resize/scroll, so
 * a pointermove costs N style writes and zero layout reads.
 *
 * Fine pointers only. On touch there is no hover, the effect would fire once
 * on tap and stick, and it would be work for nothing.
 */
export function usePointerGlow<T extends HTMLElement>(selector = '[data-glow]') {
  const ref = useRef<T | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const root = ref.current
    if (!root || reduced) return
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) {
      return
    }

    let cards: HTMLElement[] = []
    let rects: DOMRect[] = []
    let pending = 0
    let px = 0
    let py = 0

    const measure = () => {
      cards = Array.from(root.querySelectorAll<HTMLElement>(selector))
      rects = cards.map((c) => c.getBoundingClientRect())
    }

    const paint = () => {
      pending = 0
      for (let i = 0; i < cards.length; i++) {
        const r = rects[i]
        if (!r) continue
        cards[i].style.setProperty('--gx', `${(px - r.left).toFixed(1)}px`)
        cards[i].style.setProperty('--gy', `${(py - r.top).toFixed(1)}px`)
      }
    }

    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!pending) pending = requestAnimationFrame(paint)
    }

    const onEnter = () => {
      measure()
      root.style.setProperty('--glow', '1')
    }
    const onLeave = () => root.style.setProperty('--glow', '0')

    measure()
    root.addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('pointerenter', onEnter)
    root.addEventListener('pointerleave', onLeave)
    const unsub = onScrollFrame(measure)

    return () => {
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerenter', onEnter)
      root.removeEventListener('pointerleave', onLeave)
      unsub()
      if (pending) cancelAnimationFrame(pending)
    }
  }, [selector, reduced])

  return ref
}

// ── Count-up ────────────────────────────────────────────────────────────────

/**
 * Animated figure. The animation is the section's ARGUMENT — the claim is that
 * these numbers move — so it is not decoration and it does not run on load; it
 * runs when the reader is looking at it.
 */
export function useCountUp(target: number, start: boolean, duration = 1100) {
  const [value, setValue] = useState(0)
  const [settled, setSettled] = useState(false)
  const reduced = useReducedMotion()
  const frameRef = useRef(0)

  useEffect(() => {
    if (!start) return
    if (reduced) {
      setValue(target)
      setSettled(true)
      return
    }
    let t0 = 0
    const tick = (now: number) => {
      if (!t0) t0 = now
      const p = Math.min((now - t0) / duration, 1)
      // easeOutExpo — leaves fast, lands precisely on the number.
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
      setValue(Math.round(target * eased))
      if (p < 1) frameRef.current = requestAnimationFrame(tick)
      else setSettled(true)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, start, duration, reduced])

  return { value, settled }
}
