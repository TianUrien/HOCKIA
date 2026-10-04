import { Calendar, Clock } from 'lucide-react'
import type { Vacancy } from '@/lib/supabase'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { formatActivityAge } from '@/lib/inboxTime'
import { dayFirst } from '@/lib/dayFirst'
import { genderPill, roleHeadline, rolePackageItems, whenLine } from '@/lib/opportunityCopy'
import { positionLabel } from '@/lib/identity'

export interface RoleCardProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  /** 'club' or 'coach' — decides the crest shape. */
  publisherRole: string | null | undefined
  countryFlag: string | null
  league: string | null
  /** The viewer already applied: a neutral "Applied" tag after the team tag. */
  applied: boolean
  /** The whole card opens the role detail; Apply lives only in the detail bottom bar. */
  onOpen: () => void
}

/**
 * Card / Role (Figma 541:9107, Status Open | Applied): crest 48 · club ·
 * "flag city · league" · age, the role title, position + category tag,
 * "start · duration" (+ "Apply by <date>"), up to six Package items. No
 * button (founder ruling 2026-10-04): the whole card is one tap target that
 * opens the role detail, where Apply lives. An applied role carries a neutral
 * "Applied" tag after the team tag. No level, no counts, no reply time.
 */
export function RoleCard({ vacancy, clubName, clubLogo, publisherRole, countryFlag, league, applied, onOpen }: RoleCardProps) {
  // Player and coach roles alike: position (or coaching role) + the team tag.
  const pill = genderPill(vacancy.gender)
  // The club's title leads; position (or coaching role) + team sit under it.
  const headline = roleHeadline(vacancy)
  const positionText = positionLabel(vacancy.position)
  const place = [vacancy.location_city, vacancy.location_country].map((s) => s?.trim()).filter(Boolean).join(', ')
  const placeLine = [countryFlag && place ? `${countryFlag} ${place}` : place, league].filter(Boolean).join(' · ')
  const items = rolePackageItems(vacancy)
  const applyBy = vacancy.application_deadline ? dayFirst(vacancy.application_deadline) : null

  return (
    <article className="rounded-card border border-line bg-white px-4 py-3.5" data-testid="role-card" data-status={applied ? 'applied' : 'open'}>
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={applied ? `${headline.title} at ${clubName}, applied` : `${headline.title} at ${clubName}`} data-testid="role-card-open">
        <div className="flex items-center gap-3">
          <EntityAvatar src={clubLogo} name={clubName} role={publisherRole ?? 'club'} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-row font-semibold text-ink-1">{clubName}</p>
            {placeLine && <p className="truncate text-secondary text-ink-2">{placeLine}</p>}
          </div>
          <span className="flex shrink-0 items-center gap-1 self-start pt-0.5 text-secondary text-ink-3">
            <Clock className="h-[13px] w-[13px]" strokeWidth={1.8} />
            {formatActivityAge(vacancy.created_at)}
          </span>
        </div>

        <h3 className="mt-3 line-clamp-2 break-words text-title text-ink-1">{headline.title}</h3>
        {(positionText || pill || applied) && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {positionText && <span className="text-row font-semibold text-ink-2">{positionText}</span>}
            {pill && <span className={`rounded-full px-2 py-0.5 text-secondary font-semibold ${pill.className}`} data-testid="category-tag">{pill.label}</span>}
            {applied && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-secondary font-semibold text-ink-2" data-testid="applied-tag">Applied</span>}
          </div>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[14px] leading-[19px] text-ink-2">
          <Calendar className="h-[15px] w-[15px]" strokeWidth={1.6} />
          <span>{whenLine(vacancy)}</span>
          {applyBy && <span data-testid="role-card-apply-by">· Apply by {applyBy}</span>}
        </p>

        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-2" data-testid="role-card-package">
          {items.map((it) => (
            <li key={it.key} data-type={it.type} className="flex items-center gap-1.5 text-[14px] font-medium text-ink-1">
              <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-tile ${it.tileClass}`}><it.icon className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
              {it.label}
            </li>
          ))}
        </ul>
      </button>

    </article>
  )
}
