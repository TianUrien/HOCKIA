import type { ReactNode } from 'react'

/**
 * AuroraHero — the hero at the top of every role's Pulse (Home redesign V2,
 * re-skinned in the 2026-09-19 UI redesign). Was a dark #0b0a16 card with
 * neon aurora blobs + lime stats; now a calm violet-tinted surface in the
 * same language as the rest of the app: light ground, near-black type, one
 * brand accent. The role accent survives as a soft corner wash.
 *
 * Tokens: surface #F3F0FA · wash = role accent @ 14% · label = brand violet
 * · numbers #14141c · deltas emerald.
 */
interface AuroraHeroProps {
  /** Role accent for the corner wash (hex). */
  accent?: string
  children: ReactNode
}

export function AuroraHero({ accent = '#7c3aed', children }: AuroraHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#F3F0FA] px-5 py-5 text-gray-900">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full opacity-[0.14] blur-2xl" style={{ backgroundColor: accent }} />
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

/** Small caps label used above the hero headline. */
export function HeroLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-hockia-primary">{children}</p>
  )
}

/** A quiet pill (streak, season, growth chip). */
export function HeroChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-800 shadow-[0_1px_2px_rgba(20,20,28,0.06)]">
      {children}
    </span>
  )
}
