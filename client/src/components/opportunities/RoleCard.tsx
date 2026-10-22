import type { Vacancy } from '@/lib/supabase'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { CrestTile } from '@/components/opportunities/RoleCover'
import { CATEGORY_DOT_CLASSES, categoryFamily, genderPill, isPaid, roleBenefits, roleHeadline, whenLine } from '@/lib/opportunityCopy'
import { roleStatus } from '@/lib/opportunityRails'
import { usePressSpring } from '@/hooks/usePressSpring'
import { useRolePrefetch } from '@/hooks/useRolePrefetch'
import { getImageUrl } from '@/lib/imageUrl'

export interface RoleCardProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  /** 'club' or 'coach' — the crest shape: tile for a club, circle for an independent coach. */
  publisherRole: string | null | undefined
  countryFlag: string | null
  league: string | null
  /** The viewer already applied: a neutral "Applied" tag after the team tag. */
  applied: boolean
  /** The whole card opens the role detail; Apply lives only in the detail bottom bar. */
  onOpen: () => void
  /** A coach who posted for the club (lib/opportunityIdentity): the "Posted by" capsule. */
  postedBy?: { name: string; avatar: string | null; roleLabel?: string | null } | null
  now?: Date
}

const MAX_PACKAGE_CHIPS = 3

/**
 * Card / Opportunity (Figma 146:104, Opportunities v2): crest tile 52 ·
 * role title 17 · "Club · 🇮🇪 City · league", then the "Posted by" capsule
 * when a coach posted for the club, the category chip (dot + label, the
 * team's own colour; Girls/Boys = outline) and up to three package chips,
 * and a footer "Starts … · duration" + status (New / Closes in N days /
 * Closes 30 Nov). One tap target (founder ruling 2026-10-04): the card
 * opens the detail, Apply lives there. No save (ruling 2026-09-20, kept
 * 16 Oct 2026). No level, no counts, no reply time.
 */
export function RoleCard({ vacancy, clubName, clubLogo, publisherRole, countryFlag, league, applied, onOpen, postedBy = null, now }: RoleCardProps) {
  const press = usePressSpring<HTMLButtonElement>()
  const prefetch = useRolePrefetch(vacancy.id, press.ref)
  const pill = genderPill(vacancy.gender)
  const family = categoryFamily(vacancy.gender)
  const youth = vacancy.gender === 'Girls' || vacancy.gender === 'Boys'
  const headline = roleHeadline(vacancy)
  const city = vacancy.location_city?.trim() || vacancy.location_country?.trim() || ''
  const subline = [clubName, countryFlag && city ? `${countryFlag} ${city}` : city, league].filter(Boolean).join(' · ')
  const packageChips = [...(isPaid(vacancy) ? ['€ Paid'] : []), ...roleBenefits(vacancy).map((b) => b.label), ...(vacancy.custom_benefits ?? [])]
  const shown = packageChips.slice(0, MAX_PACKAGE_CHIPS)
  const more = packageChips.length - shown.length
  const status = roleStatus(vacancy, now)
  const isCoachCircle = publisherRole === 'coach'

  return (
    <article className="h-full rounded-[24px] border-[0.5px] border-[rgba(15,15,20,0.06)] bg-white px-4 pb-3.5 pt-4 shadow-[0_8px_12px_rgba(15,15,20,0.08),0_1px_1px_rgba(15,15,20,0.05)] lg:transition-[transform,box-shadow] lg:duration-200 lg:hover:-translate-y-0.5 lg:hover:shadow-[0_14px_24px_rgba(15,15,20,0.12),0_1px_1px_rgba(15,15,20,0.05)]" data-testid="role-card" data-status={applied ? 'applied' : 'open'}>
      <button
        ref={press.ref}
        type="button"
        onClick={onOpen}
        {...press.handlers}
        {...prefetch.handlers}
        className="block w-full text-left [transform-origin:center] [will-change:transform]"
        aria-label={applied ? `${headline.title} at ${clubName}, applied` : `${headline.title} at ${clubName}`}
        data-testid="role-card-open"
      >
        <div className="flex items-start gap-3">
          {isCoachCircle
            ? <EntityAvatar src={clubLogo} name={clubName} role="coach" size={52} />
            : <CrestTile src={clubLogo} name={clubName} size={52} radius={14} />}
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-body font-semibold text-ink-1">{headline.title}</p>
            <p className="truncate text-secondary text-ink-2" data-testid="role-card-subline">{subline}</p>
          </div>
        </div>

        {postedBy && (
          <span className="mt-3 inline-flex max-w-full items-center gap-1 rounded-full bg-surface-subtle py-[5px] pl-1.5 pr-3 text-secondary text-ink-2" data-testid="role-posted-by">
            <EntityAvatar src={postedBy.avatar ? getImageUrl(postedBy.avatar, 'avatar-sm') ?? postedBy.avatar : null} name={postedBy.name} role="coach" size={22} />
            <span>Posted by</span>
            <span className="truncate font-semibold text-ink-1">{postedBy.name}</span>
            {postedBy.roleLabel && <span className="truncate">· {postedBy.roleLabel}</span>}
          </span>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="role-card-package">
          {pill && family && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-secondary font-semibold ${youth ? `border-[1.25px] ${pill.className.split(' ').filter((c) => c.startsWith('text-')).join(' ')} border-current` : pill.className}`}
              data-testid="category-tag"
            >
              <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${CATEGORY_DOT_CLASSES[family]}`} />
              {pill.label}
            </span>
          )}
          {applied && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-secondary font-semibold text-ink-2" data-testid="applied-tag">Applied</span>}
          {shown.map((label) => (
            <span key={label} className="rounded-full bg-surface-muted px-2 py-[3px] text-caption text-ink-2">{label}</span>
          ))}
          {more > 0 && <span className="rounded-full bg-surface-muted px-2 py-[3px] text-caption text-ink-2">+{more}</span>}
        </div>

        <div className="mt-3 flex items-center gap-2 text-caption">
          <span className="min-w-0 flex-1 truncate text-ink-3">{whenLine(vacancy)}</span>
          {status && (
            <span
              className={`shrink-0 ${status.tone === 'brand' ? 'font-semibold text-brand-primary' : status.tone === 'amber' ? 'font-semibold text-status-warning' : 'text-ink-1'}`}
              data-testid={vacancy.application_deadline ? 'role-card-apply-by' : 'role-card-status'}
            >
              {status.label}
            </span>
          )}
        </div>
      </button>
    </article>
  )
}
