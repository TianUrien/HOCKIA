import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export interface WeekTile {
  id: string
  value: number
  label: string
  /** One short line under the label ("4 more vs last week"). */
  sub: string
  to?: string
}

/**
 * The four tiles of Your week v2 (Figma 42:276): 2×2 on a grouped surface,
 * tile radius 8 (Foundations radius/sm). Every value is the player's own
 * number — views, recruiters, new roles, club replies — never a score, a
 * level or an applicant count.
 */
export function WeekTiles({ tiles, loading }: { tiles: WeekTile[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-card bg-surface-grouped p-2" data-testid="week-tiles">
      {tiles.map((t) => {
        const body = (
          <>
            {loading ? (
              <span className="block h-[31px] w-10 animate-pulse rounded-md bg-surface-grouped" />
            ) : (
              <span className="block text-[26px] font-semibold leading-[31px] tracking-[-0.01em] tabular-nums text-ink-1" data-testid={`week-tile-${t.id}-value`}>
                {t.value}
              </span>
            )}
            <span className="mt-0.5 block text-secondary font-medium text-ink-1">{t.label}</span>
            <span className={cn('block truncate text-caption text-ink-3', loading && 'invisible')} data-testid={`week-tile-${t.id}-sub`}>{t.sub}</span>
          </>
        )
        const cls = 'block min-w-0 rounded-tile bg-white px-3.5 py-3 text-left'
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
