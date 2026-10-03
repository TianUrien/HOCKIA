import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, EyeOff } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { useCountries } from '@/hooks/useCountries'
import { getImageUrl } from '@/lib/imageUrl'
import { formatActivityAge } from '@/lib/inboxTime'
import { viewerLines, type ViewerLine, type WeekViewerRow } from '@/lib/pulseWeek'
import { cn } from '@/lib/utils'

/**
 * "Who looked at you" (Your week v2, Figma 42:276): club and coach viewers
 * of the last 7 days as a horizontal rail of grey cards — avatar 48, name
 * (two lines), "Role · flag". "See all" expands the full vertical list under
 * the rail, where each row also carries when they looked. A viewer browsing
 * anonymously is a masked card/row ("Private" / "Browsing hidden") with the
 * generic avatar and no link. Players who viewed never appear here (founder
 * ruling 2026-10-03). Renders nothing with no rows: the check-in card's top
 * line already says "No profile views yet this week".
 */
export function WhoLookedAtYou({ rows }: { rows: readonly WeekViewerRow[] }) {
  const { getCountryById } = useCountries()
  const [all, setAll] = useState(false)
  const lines = viewerLines(rows)
  if (lines.length === 0) return null

  const caption = (v: ViewerLine) => {
    const flag = v.countryId != null ? getCountryById(v.countryId)?.flag_emoji ?? null : null
    return [v.meta, flag].filter(Boolean).join(' · ')
  }
  const avatar = (v: ViewerLine, size: 48 | 44) =>
    v.hidden ? (
      <span className="flex shrink-0 items-center justify-center rounded-full bg-white text-ink-3" style={{ width: size, height: size }} aria-hidden="true">
        <EyeOff className="h-5 w-5" strokeWidth={1.75} />
      </span>
    ) : (
      <EntityAvatar src={getImageUrl(v.avatarUrl, 'avatar-md') ?? v.avatarUrl} name={v.name} role={v.role} size={size} />
    )

  return (
    <section aria-label="Who looked at you" data-testid="who-looked">
      <div className="flex items-center justify-between pb-2 pr-1">
        <h2 className="text-body font-semibold text-ink-1">Who looked at you</h2>
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="flex h-8 items-center gap-0.5 text-secondary font-semibold text-hockia-primary"
          data-testid="who-looked-see-all"
        >
          {all ? 'Show less' : 'See all'}
          <ChevronRight className={cn('h-4 w-4 transition-transform', all && 'rotate-90')} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="who-looked-rail">
        {lines.map((v) => {
          const inner = (
            <>
              {avatar(v, 48)}
              <span className="mt-2 line-clamp-2 w-full text-center text-secondary font-semibold leading-[17px] text-ink-1">{v.name}</span>
              <span className="mt-0.5 w-full truncate text-center text-caption text-ink-2">{caption(v)}</span>
            </>
          )
          const cls = 'flex h-full w-full flex-col items-center rounded-card bg-surface-grouped px-2 pb-3 pt-3.5'
          return (
            <li key={v.key} className="w-28 shrink-0" data-testid={v.hidden ? 'viewer-card-hidden' : 'viewer-card'}>
              {v.path ? <Link to={v.path} className={cn(cls, 'active:bg-surface-muted')}>{inner}</Link> : <div className={cls}>{inner}</div>}
            </li>
          )
        })}
      </ul>

      {all && (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped" data-testid="who-looked-list">
          {lines.map((v) => {
            const inner = (
              <>
                {avatar(v, 44)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-row font-semibold text-ink-1">{v.name}</span>
                  <span className="block truncate text-secondary text-ink-2">{caption(v)}</span>
                </span>
                <span className="shrink-0 text-caption text-ink-3">{formatActivityAge(v.viewedAt)}</span>
              </>
            )
            return (
              <li key={v.key} data-testid={v.hidden ? 'viewer-row-hidden' : 'viewer-row'}>
                {v.path ? (
                  <Link to={v.path} className="flex items-center gap-3 px-4 py-2.5 active:bg-surface-muted">{inner}</Link>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
