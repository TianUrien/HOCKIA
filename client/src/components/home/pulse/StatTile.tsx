import type { ReactNode } from 'react'

/**
 * StatTile — a single stat inside the AuroraHero (profile views / previews /
 * new connections, etc). Big real number + label + optional week-over-week
 * delta. One tile may carry the accent as the headline signal.
 *
 * "Every number must be real": render a tile only when the caller has a real
 * value — empty modules collapse upstream, per the redesign's empty-state rule.
 */
interface StatTileProps {
  value: number | string
  label: string
  /** Signed week-over-week delta; omit to hide the delta line. */
  delta?: number | null
  /** Accent the value (the module's headline stat). */
  accent?: boolean
}

export function StatTile({ value, label, delta, accent }: StatTileProps) {
  return (
    <div className="flex-1 rounded-xl bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(20,20,28,0.05)]">
      <div className={`text-2xl font-bold leading-none tabular-nums ${accent ? 'text-hockia-primary' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium leading-tight text-gray-500">{label}</div>
      {delta != null && delta !== 0 && (
        <div className={`mt-0.5 text-[11px] font-bold tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
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
