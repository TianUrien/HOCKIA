import { Link } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface WeekTile {
  id: string
  value: number
  label: string
  /** One short line under the label ("4 more vs last week"). */
  sub: string
  /** 'positive' draws the sub-line green with an up arrow (views up). */
  tone?: 'grey' | 'positive'
  to?: string
}

/**
 * The four tiles of Your week v2 (Figma 42:276): grey tiles (radius 16) on
 * the white page, two columns, 12px gap. Every value is the player's own
 * number — views, recruiters, new roles, club replies — never a score, a
 * level or an applicant count. The only colour is a positive views delta.
 */
export function WeekTiles({ tiles, loading }: { tiles: WeekTile[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="week-tiles">
      {tiles.map((t) => {
        const positive = t.tone === 'positive' && !loading
        const body = (
          <>
            {loading ? (
              <span className="block h-[31px] w-10 animate-pulse rounded-md bg-line" />
            ) : (
              <span className="block text-[26px] font-semibold leading-[31px] tracking-[-0.01em] tabular-nums text-ink-1" data-testid={`week-tile-${t.id}-value`}>
                {t.value}
              </span>
            )}
            <span className="mt-0.5 block text-row font-semibold text-ink-1">{t.label}</span>
            <span
              className={cn('mt-0.5 flex items-center gap-0.5 text-caption', positive ? 'font-medium text-status-positive' : 'text-ink-2', loading && 'invisible')}
              data-testid={`week-tile-${t.id}-sub`}
            >
              {positive && <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
              <span className="truncate">{t.sub}</span>
            </span>
          </>
        )
        const cls = 'block min-w-0 rounded-card bg-surface-grouped px-4 py-3.5 text-left'
        return t.to ? (
          <Link key={t.id} to={t.to} className={cn(cls, 'active:bg-surface-muted')} aria-label={`${t.label}: ${t.value}, ${t.sub}`}>
            {body}
          </Link>
        ) : (
          <div key={t.id} className={cls}>{body}</div>
        )
      })}
    </div>
  )
}
