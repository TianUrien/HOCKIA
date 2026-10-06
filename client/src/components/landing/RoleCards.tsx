import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useInView, useReducedMotion } from '@/lib/motion'
import { webButtonClassName, WEB_LINK_CHEVRON } from '@/components/ui/buttonClasses'
import { placeLine, postedAgo, type ClubCrest, type OpenRoleCard } from '@/lib/landingRoles'

/**
 * Open roles on the web landing (Figma "Landing v3" 122:1885, 6 Oct 2026):
 * the crest strip ("Clubs recruiting on Hockia") and the role cards.
 *
 * The whole card is one link to the role page. Desktop: three columns.
 * Phones: a 300-wide scroll-snap carousel with the next card peeking — the
 * browser drives the momentum, there is no JS carousel. Data is the public
 * opportunities read (lib/landingRoles); every missing field drops its line
 * rather than showing a placeholder.
 */

const LV3_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const CREST_STAGGER_MS = 60
/** Chips shown before the "+N" overflow. */
const MAX_PACKAGE_CHIPS = 3

export function CrestStrip({ crests }: { crests: ClubCrest[] }) {
  // One-shot: the strip fades in with a 60 ms stagger when the section
  // enters view (IntersectionObserver via lib/motion, not scroll-linked).
  const { ref, inView } = useInView<HTMLDivElement>()
  const reduced = useReducedMotion()
  if (crests.length === 0) return null
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-x-4 gap-y-3 lg:gap-x-5" data-testid="crest-strip">
      <p className="text-[13px] font-semibold leading-[18px] text-ink-3">Clubs recruiting on Hockia</p>
      <ul className="flex items-center gap-2.5 lg:gap-3.5" aria-label="Clubs recruiting on Hockia">
        {crests.map((c, i) => (
          <li
            key={c.name}
            className="group relative"
            style={{
              opacity: inView ? 1 : 0,
              transform: inView ? 'translateY(0)' : 'translateY(8px)',
              transition: reduced
                ? 'none'
                : `opacity 500ms ${LV3_EASE} ${i * CREST_STAGGER_MS}ms, transform 500ms ${LV3_EASE} ${i * CREST_STAGGER_MS}ms`,
            }}
          >
            <img
              src={c.url}
              alt={c.name}
              title={c.name}
              width={56}
              height={56}
              loading="lazy"
              className="lv3-crest h-12 w-12 object-contain transition-transform duration-200 ease-out group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:transform-none lg:h-14 lg:w-14"
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RoleCard({ role, now, onClick, className = '' }: {
  role: OpenRoleCard
  now: Date
  onClick?: () => void
  className?: string
}) {
  const place = placeLine(role)
  const ago = postedAgo(role.createdAt, now)
  const chips = role.packages.slice(0, MAX_PACKAGE_CHIPS)
  const more = role.packages.length - chips.length
  return (
    <Link
      to={`/opportunities/${role.id}`}
      onClick={onClick}
      data-testid="role-card"
      className={`group/card flex h-full flex-col gap-4 rounded-[20px] border border-line bg-white p-6 shadow-[0_1px_2px_rgba(15,15,20,0.04)] transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:border-brand-primary/35 hover:shadow-[0_16px_40px_rgba(108,43,217,0.12)] focus:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-reduce:transition-none motion-reduce:transform-none ${className}`}
    >
      {/* Row 1: crest · club + place · posted-ago */}
      <div className="flex items-start gap-3">
        {role.crestUrl && (
          <img
            src={role.crestUrl}
            alt=""
            width={52}
            height={52}
            loading="lazy"
            className="lv3-crest h-[52px] w-[52px] shrink-0 object-contain transition-transform duration-200 ease-out group-hover/card:scale-[1.04] motion-reduce:transition-none motion-reduce:transform-none"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {role.clubName && (
            <p className="truncate text-[17px] font-semibold leading-[22px] text-ink-1" title={role.clubName}>{role.clubName}</p>
          )}
          {place && (
            <p className="truncate text-[13px] leading-[18px] text-ink-3" title={place}>
              {role.flag && <span aria-hidden="true">{role.flag} </span>}
              {place}
            </p>
          )}
        </div>
        {ago && (
          <span className="shrink-0 text-[13px] leading-[18px] text-ink-3" aria-label={`Posted ${ago}`}>{ago}</span>
        )}
      </div>

      {/* Row 2: position + team tag */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[24px] font-semibold leading-[30px] text-ink-1">{role.position}</h3>
        {role.team && (
          <span className="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-[12px] font-semibold leading-4 text-brand-primary">
            {role.team}
          </span>
        )}
      </div>

      {/* Row 3: start · duration */}
      {role.when && <p className="text-[14px] font-medium leading-5 text-ink-2">{role.when}</p>}

      {/* Row 4: package chips */}
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Package">
          {chips.map((p) => (
            <li key={p} className="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-[5px] text-[12px] font-semibold leading-4 text-ink-2">{p}</li>
          ))}
          {more > 0 && (
            <li className="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-[5px] text-[12px] font-semibold leading-4 text-ink-2">+{more}</li>
          )}
        </ul>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
        <span className="text-[14px] leading-5 text-ink-3">Apply in the app</span>
        <span className={webButtonClassName({ variant: 'link', size: 'medium', className: 'h-5 group-hover/card:underline' })}>
          View role
          <ChevronRight className={`${WEB_LINK_CHEVRON} group-hover/card:translate-x-0.5`} aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}
