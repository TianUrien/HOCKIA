import { useCallback, useEffect, useRef, useState } from 'react'
import { UserRound, ClipboardList, Building2, Sparkles, ShieldCheck, Handshake } from 'lucide-react'
import {
  useInView,
  usePointerGlow,
  useReducedMotion,
  stagger,
  EASE_ENTRANCE,
  DUR_ENTRANCE,
} from '@/lib/motion'

/**
 * "Built for everyone who makes field hockey happen."
 *
 * ONE DOM tree, two behaviours:
 *   • ≥640px — a grid lit by the cursor. The glow bleeds between neighbours,
 *     so six boxes read as a single lit surface.
 *   • <640px — a snap carousel. Six stacked cards is a long scroll past
 *     secondary content; a rail with a visible peek of the next card turns it
 *     into one screen. The browser drives the momentum — no JS carousel
 *     matches the platform's own inertia on iOS — and JS only reads position
 *     to scale the neighbours and light the dots.
 *
 * Duplicating the markup per breakpoint would double the DOM and desync the
 * two copies the first time someone edits one of them, so the layout switch is
 * pure CSS and the JS no-ops when the rail isn't scrollable.
 */

const ROLES = [
  { t: 'Players', d: 'Build the profile that gets you found, and find opportunities that fit.', icon: UserRound },
  { t: 'Coaches', d: 'Show your coaching journey and connect with clubs that need you.', icon: ClipboardList },
  { t: 'Clubs', d: 'Present your club, recruit with full context, and reach the wider hockey world.', icon: Building2 },
  { t: 'Brands', d: 'Understand the community and find meaningful ways to take part in the sport.', icon: Sparkles },
  { t: 'Umpires', d: 'Be visible in the ecosystem and connect beyond the matchday.', icon: ShieldCheck },
  { t: 'Everyone else', d: 'One place for the people and organisations moving the sport forward.', icon: Handshake },
] as const

export default function RoleCards() {
  const glowRef = usePointerGlow<HTMLDivElement>('[data-glow]')
  const { ref: viewRef, inView } = useInView<HTMLDivElement>()
  const railRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(0)
  const [scrollable, setScrollable] = useState(false)
  const reduced = useReducedMotion()

  // Proximity-to-centre drives each card's scale/opacity on the rail, so the
  // focused card is obvious mid-swipe rather than only after the snap lands.
  const paint = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const canScroll = rail.scrollWidth - rail.clientWidth > 8
    setScrollable(canScroll)

    const cards = Array.from(rail.children) as HTMLElement[]
    if (!canScroll) {
      for (const c of cards) c.style.removeProperty('--near')
      return
    }

    const mid = rail.scrollLeft + rail.clientWidth / 2
    let best = 0
    let bestDist = Infinity
    cards.forEach((c, i) => {
      const centre = c.offsetLeft + c.offsetWidth / 2
      const dist = Math.abs(centre - mid)
      // 1 at dead centre, 0 once a full card-width away.
      const near = Math.max(0, 1 - dist / c.offsetWidth)
      c.style.setProperty('--near', near.toFixed(3))
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    setActive(best)
  }, [])

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        paint()
      })
    }
    paint()
    rail.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      rail.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [paint])

  const goTo = (i: number) => {
    const rail = railRef.current
    const card = rail?.children[i] as HTMLElement | undefined
    if (!rail || !card) return
    rail.scrollTo({
      left: card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  return (
    <div ref={viewRef}>
      <div ref={glowRef}>
        <div
          ref={railRef}
          className="snap-rail -mx-6 flex gap-4 overflow-x-auto px-6 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3"
          // A scrollable region with no focusable children still has to be
          // reachable and operable by keyboard — but ONLY while it actually
          // scrolls. Above the rail breakpoint this is a plain grid, and a
          // permanent tab stop there is just a dead stop between the heading
          // and the next link.
          tabIndex={scrollable ? 0 : undefined}
          role="group"
          aria-label="Who HOCKIA is built for"
        >
          {ROLES.map((r, i) => {
            const Icon = r.icon
            return (
              <article
                key={r.t}
                data-glow
                className="glow-card rail-card snap-item group h-auto w-[80%] flex-shrink-0 rounded-2xl border border-gray-100 bg-white p-6 sm:w-auto"
                style={{
                  opacity: inView ? 1 : 0,
                  transform: inView ? 'translateY(0)' : 'translateY(14px)',
                  transition: reduced
                    ? 'none'
                    : `opacity ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${stagger(i)}ms, transform ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${stagger(i)}ms, box-shadow 240ms ${EASE_ENTRANCE}, border-color 240ms ${EASE_ENTRANCE}`,
                }}
              >
                {/* Inner element carries the rail's proximity scale. The
                    entrance above writes `transform` inline, and an inline
                    style always beats a stylesheet rule — two animations on
                    one element would silently drop one of them. */}
                <div className="rail-inner">
                  <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-hockia-primary/[0.07] text-hockia-primary transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-translate-y-0.5 group-hover:scale-[1.06] motion-reduce:transform-none">
                    <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-bold text-gray-900">{r.t}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-gray-600">{r.d}</p>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      {/* Rail position. Hidden when the cards are a grid — and when the rail
          somehow isn't scrollable, so it can never be a row of dead dots. */}
      {scrollable && (
        <div className="mt-5 flex items-center justify-center gap-2 sm:hidden">
          {ROLES.map((r, i) => (
            <button
              key={r.t}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show ${r.t}`}
              aria-current={active === i}
              className="group flex h-11 w-6 items-center justify-center focus-visible:outline-none"
            >
              <span
                className={`block h-1.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-focus-visible:ring-2 group-focus-visible:ring-hockia-primary/50 group-focus-visible:ring-offset-2 ${
                  active === i ? 'w-5 bg-hockia-primary' : 'w-1.5 bg-gray-300'
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
