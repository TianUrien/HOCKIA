import { Link } from 'react-router-dom'
import { EyeOff } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { useCountries } from '@/hooks/useCountries'
import { getImageUrl } from '@/lib/imageUrl'
import { formatActivityAge } from '@/lib/inboxTime'
import { viewerLines, type WeekViewerRow } from '@/lib/pulseWeek'

/**
 * "Who looked at you" (Your week v2, Figma 42:276): club and coach viewers
 * of the last 7 days as rows — name · flag · role, EntityAvatar (club = rounded
 * square, coach = circle). A viewer browsing anonymously is a masked row,
 * "Private · Browsing hidden", with a generic avatar and no link. Players who
 * viewed never appear here (founder ruling 2026-10-03). Renders nothing with
 * no rows: the header line already says "No profile views yet this week".
 */
export function WhoLookedAtYou({ rows }: { rows: readonly WeekViewerRow[] }) {
  const { getCountryById } = useCountries()
  const lines = viewerLines(rows)
  if (lines.length === 0) return null

  return (
    <section aria-label="Who looked at you" data-testid="who-looked">
      <h2 className="px-1 pb-2 text-body font-semibold text-ink-1">Who looked at you</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
        {lines.map((v) => {
          const flag = v.countryId != null ? getCountryById(v.countryId)?.flag_emoji ?? null : null
          const meta = [v.meta, flag].filter(Boolean).join(' · ')
          const inner = (
            <>
              {v.hidden ? (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink-3" aria-hidden="true">
                  <EyeOff className="h-5 w-5" strokeWidth={1.75} />
                </span>
              ) : (
                <EntityAvatar src={getImageUrl(v.avatarUrl, 'avatar-md') ?? v.avatarUrl} name={v.name} role={v.role} size={44} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-row font-semibold text-ink-1">{v.name}</span>
                <span className="block truncate text-secondary text-ink-2">{meta}</span>
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
    </section>
  )
}
