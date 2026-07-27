import { useEffect, useState } from 'react'
import { Users, Globe2, Building2, Briefcase } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import {
  useInView,
  usePointerGlow,
  useReducedMotion,
  useCountUp,
  stagger,
  EASE_ENTRANCE,
  DUR_ENTRANCE,
} from '@/lib/motion'

/**
 * The landing proof strip.
 *
 * Two problems with the original: the numbers were hard-coded (a page arguing
 * "this is a real, active platform" cannot print a frozen count), and four
 * loose figures under a hairline read as an afterthought.
 *
 * Now: one considered object rather than four stray numbers, and the figures
 * are LIVE from get_landing_stats(). The count-up is not decoration — it is
 * the section's argument, which is that these numbers move — so it runs when
 * the reader is looking at it, not on load.
 *
 * Never shows an empty or zero state: last-known values render until the live
 * ones land, and they stay if the fetch fails.
 */

interface Stat {
  key: string
  label: string
  value: number
  icon: typeof Users
}

/** Last-known good figures (prod, 2026-07-25). Only ever visible if the live
 *  call fails — better a slightly stale truth than a zero or a spinner. */
const FALLBACK = { members: 258, nationalities: 43, clubs_mapped: 281, open_roles: 11 }

function StatCell({ stat, animate, index }: { stat: Stat; animate: boolean; index: number }) {
  const { value, settled } = useCountUp(stat.value, animate)
  const reduced = useReducedMotion()
  const Icon = stat.icon

  return (
    <div
      className="group/cell relative flex flex-col items-center px-4 py-6 text-center sm:px-6 sm:py-8"
      style={{
        opacity: animate ? 1 : 0,
        transform: animate ? 'translateY(0)' : 'translateY(10px)',
        transition: reduced
          ? 'none'
          : `opacity ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${stagger(index)}ms, transform ${DUR_ENTRANCE}ms ${EASE_ENTRANCE} ${stagger(index)}ms`,
      }}
    >
      <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-hockia-primary/[0.07] text-hockia-primary transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/cell:-translate-y-0.5 group-hover/cell:scale-[1.08] motion-reduce:transform-none">
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
      </span>
      {/* key={settled} restarts the settle animation exactly once, when the
          count lands — so the figure arrives rather than merely stopping. */}
      <span
        key={settled ? 'done' : 'running'}
        className={`text-[2rem] font-extrabold leading-none tracking-[-0.03em] text-gray-900 tabular-nums sm:text-[2.5rem] ${
          settled && !reduced ? 'digit-settle' : ''
        }`}
      >
        {value.toLocaleString()}
      </span>
      <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
        {stat.label}
      </span>
    </div>
  )
}

export default function LandingStats() {
  const [data, setData] = useState(FALLBACK)
  const { ref, inView } = useInView<HTMLDivElement>('0px 0px -10% 0px')
  const glowRef = usePointerGlow<HTMLDivElement>('[data-glow]')
  const reduced = useReducedMotion()

  // Live figures. Failure is silent and keeps the fallback — a marketing page
  // must never render a zero because a query timed out.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data: rows, error } = await supabase.rpc('get_landing_stats')
        if (error) throw error
        const row = Array.isArray(rows) ? rows[0] : rows
        if (!row || cancelled) return
        setData({
          members: Number(row.members) || FALLBACK.members,
          nationalities: Number(row.nationalities) || FALLBACK.nationalities,
          clubs_mapped: Number(row.clubs_mapped) || FALLBACK.clubs_mapped,
          open_roles: Number(row.open_roles) || FALLBACK.open_roles,
        })
      } catch (err) {
        logger.debug('[LandingStats] live stats unavailable, using fallback', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const stats: Stat[] = [
    { key: 'members', label: 'members', value: data.members, icon: Users },
    { key: 'nationalities', label: 'nationalities', value: data.nationalities, icon: Globe2 },
    { key: 'clubs', label: 'clubs mapped', value: data.clubs_mapped, icon: Building2 },
    { key: 'roles', label: 'open roles', value: data.open_roles, icon: Briefcase },
  ]

  return (
    <div ref={ref} className="mt-16" data-testid="landing-stats">
      <div className="mb-4 flex items-center justify-center gap-2 sm:justify-start">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hockia-primary/60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-hockia-primary" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
          Live from the platform
        </span>
      </div>

      {/* One object, not four stray figures: a single card with hairline
          dividers. Rounded boxes with accent bars would read as a template.
          The sheen sweeps once as it enters — looping it is the fastest way
          to make a page look cheap. */}
      <div ref={glowRef}>
        <dl
          data-glow
          className={`glow-card sheen relative grid grid-cols-2 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_1px_2px_rgba(16,12,32,0.04),0_12px_32px_-12px_rgba(109,40,217,0.16)] transition-[box-shadow,border-color] duration-300 sm:grid-cols-4 ${
            inView && !reduced ? 'sheen-run' : ''
          }`}
        >
          {stats.map((s, i) => (
            <div
              key={s.key}
              className={[
                // Hairlines between cells; none on the outer edges.
                i % 2 === 1 ? 'border-l border-gray-100' : '',
                i >= 2 ? 'border-t border-gray-100' : '',
                'sm:border-t-0',
                i > 0 ? 'sm:border-l sm:border-gray-100' : 'sm:border-l-0',
              ].join(' ')}
            >
              <StatCell stat={s} animate={inView} index={i} />
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
