import type { ReactNode } from 'react'

/**
 * StatTile — a single stat inside the AuroraHero (profile views / previews /
 * new connections, etc). Big real number + label + optional week-over-week
 * delta. One tile may carry the lime accent (#c6ff6b) as the headline signal.
 *
 * "Every number must be real": render a tile only when the caller has a real
 * value — empty modules collapse upstream, per the redesign's empty-state rule.
 */
interface StatTileProps {
  value: number | string
  label: string
  /** Signed week-over-week delta; omit to hide the delta line. */
  delta?: number | null
  /** Lime-accent the value (the module's headline stat). */
  accent?: boolean
}

export function StatTile({ value, label, delta, accent }: StatTileProps) {
  return (
    <div className="flex-1 rounded-2xl bg-white/[0.06] px-3 py-2.5">
      <div className={`text-2xl font-black leading-none ${accent ? 'text-[#c6ff6b]' : 'text-white'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium leading-tight text-white/70">{label}</div>
      {delta != null && delta !== 0 && (
        <div className={`mt-0.5 text-[11px] font-bold ${delta > 0 ? 'text-[#c6ff6b]' : 'text-white/50'}`}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
        </div>
      )}
    </div>
  )
}

/** Row wrapper — flexes to however many tiles survive the "never show 0"
 *  filter (1–3), so a dropped zero-value tile never leaves a gap. */
export function StatTileRow({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex gap-2">{children}</div>
}
