import type { ReactNode } from 'react'

/**
 * AuroraHero — the dark, blurred-ellipse hero at the top of every role's Pulse
 * tab (Home redesign V2). Dark #0b0a16, radius 28, with soft brand-purple
 * aurora blobs. The role sets an accent blob color; content (headline, delta,
 * chips, stat tiles, CTA) is composed by the caller.
 *
 * Design tokens (from the Figma "FOMO" file):
 *   surface #0b0a16 · aurora #7c3aed / #4f46e5 / #c026d3 + role accent
 *   label #c6b6f7 · lime stat accent #c6ff6b · chips white/12%
 */
interface AuroraHeroProps {
  /** Extra accent ellipse tint per role (Tailwind color or hex). */
  accent?: string
  children: ReactNode
}

export function AuroraHero({ accent = '#c026d3', children }: AuroraHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[#0b0a16] px-5 py-6 text-white">
      {/* Aurora blobs — decorative, non-interactive. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 -top-20 h-56 w-56 rounded-full bg-[#7c3aed] opacity-40 blur-3xl" />
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[#4f46e5] opacity-30 blur-3xl" />
        <div
          className="absolute -bottom-24 left-1/3 h-52 w-52 rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: accent }}
        />
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

/** Small caps label used above the hero headline. */
export function HeroLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#c6b6f7]">{children}</p>
  )
}

/** A white/12% pill (streak, season, growth chip). */
export function HeroChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.12] px-2.5 py-1 text-[11px] font-semibold text-white">
      {children}
    </span>
  )
}
