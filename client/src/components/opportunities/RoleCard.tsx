import { Calendar, Check, Clock } from 'lucide-react'
import type { Vacancy } from '@/lib/supabase'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { formatActivityAge } from '@/lib/inboxTime'
import {
  REQUIREMENT_TILE, SPECIALIST_TILE, compensationText, genderPill, roleBenefits, roleHeadline, whenLine,
} from '@/lib/opportunityCopy'
import { humanizeToken, positionLabel } from '@/lib/identity'

export interface RoleCardProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  /** 'club' or 'coach' — decides the crest shape. */
  publisherRole: string | null | undefined
  countryFlag: string | null
  league: string | null
  applied: boolean
  /** Whether this viewer may apply at all (players to player roles, coaches to coach roles). */
  canApply: boolean
  onOpen: () => void
  onApply: () => void
}

/**
 * Role card (Figma Opportunities v2): crest · club · place · league · age,
 * the role title, then position + category pill, start & duration, package tiles, then a
 * full-width solid Apply — or tinted Applied with a check, which opens the
 * applied detail. No level, no counts, no reply time.
 */
export function RoleCard({ vacancy, clubName, clubLogo, publisherRole, countryFlag, league, applied, canApply, onOpen, onApply }: RoleCardProps) {
  const pill = vacancy.opportunity_type === 'player' ? genderPill(vacancy.gender) : null
  // The club's title leads; position (or coaching role) + team sit under it.
  const headline = roleHeadline(vacancy)
  const positionText = positionLabel(vacancy.position)
  const place = [vacancy.location_city, vacancy.location_country].map((s) => s?.trim()).filter(Boolean).join(', ')
  const placeLine = [countryFlag && place ? `${countryFlag} ${place}` : place, league].filter(Boolean).join(' · ')
  const benefits = roleBenefits(vacancy)
  const specialists = (vacancy.specialist_skills_wanted ?? []).slice(0, 2)
  const compensation = compensationText(vacancy)

  return (
    <article className="rounded-[18px] border border-line bg-white px-4 py-3.5" data-testid="role-card">
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`${headline.title} at ${clubName}`}>
        <div className="flex items-center gap-3">
          <EntityAvatar src={clubLogo} name={clubName} role={publisherRole ?? 'club'} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-row font-semibold text-ink-1">{clubName}</p>
            {placeLine && <p className="truncate text-secondary text-ink-2">{placeLine}</p>}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-secondary text-ink-3">
            <Clock className="h-[13px] w-[13px]" strokeWidth={1.8} />
            {formatActivityAge(vacancy.created_at)}
          </span>
        </div>

        <h3 className="mt-3 line-clamp-2 break-words text-title text-ink-1">{headline.title}</h3>
        {pill ? (
          <div className="mt-1 flex items-center gap-2">
            {positionText && <span className="text-[15px] font-semibold text-ink-2">{positionText}</span>}
            <span className={`rounded-full px-2 py-0.5 text-secondary font-semibold ${pill.className}`}>{pill.label}</span>
          </div>
        ) : headline.detail && <p className="mt-1 text-[15px] font-semibold text-ink-2">{headline.detail}</p>}

        <p className="mt-2 flex items-center gap-1.5 text-[14px] leading-[19px] text-ink-2">
          <Calendar className="h-[15px] w-[15px]" strokeWidth={1.6} />
          {whenLine(vacancy)}
        </p>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
          {benefits.map((b) => (
            <span key={b.key} className="flex items-center gap-1.5 text-[14px] font-medium text-ink-1">
              <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-tile ${b.tileClass}`}><b.icon className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
              {b.label}
            </span>
          ))}
          {specialists.map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-[14px] font-medium text-ink-1">
              <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-tile ${SPECIALIST_TILE.tileClass}`}><SPECIALIST_TILE.icon className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
              {humanizeToken(s)}
            </span>
          ))}
          {vacancy.eu_passport_required && (
            <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#b45309]">
              <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-tile ${REQUIREMENT_TILE.tileClass}`}><REQUIREMENT_TILE.icon className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
              EU passport
            </span>
          )}
          {benefits.length === 0 && specialists.length === 0 && !vacancy.eu_passport_required && (
            <span className="text-[14px] text-ink-2">{compensation}</span>
          )}
        </div>
      </button>

      {canApply && (
        <div className="pt-4">
          {applied ? (
            <button
              type="button"
              onClick={onOpen}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-hockia-soft text-[16px] font-semibold text-hockia-primary"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} /> Applied
            </button>
          ) : (
            <button
              type="button"
              onClick={onApply}
              className="flex h-11 w-full items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white active:opacity-90"
            >
              Apply
            </button>
          )}
        </div>
      )}
    </article>
  )
}
