import { Check, ChevronRight } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { SignedThroughHockiaPill } from '@/components/profile/SignedThroughHockiaPill'
import type { CareerTimelineEntry } from '@/hooks/useCareerTimeline'
import { careerSpan } from '@/lib/careerCopy'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken } from '@/lib/identity'
import { cn } from '@/lib/utils'

/**
 * List item / Career entry (Figma "03 · Components" 558:12773): crest 40 with
 * a timeline line down to the next entry (hidden on the last), the team,
 * "role · league", "flag place · from – to" and up to two highlights with
 * checks. Mode Own = a chevron and the row opens the entry; Mode Public =
 * read-only, no chevron. An entry without a crest shows a muted placeholder
 * tile — never initials, and never another club's crest.
 */
export const CAREER_ITEM_HIGHLIGHTS = 2

interface CareerEntryItemProps {
  entry: CareerTimelineEntry
  /** Last in the list: no timeline line under the crest. */
  last: boolean
  /** Represented country (national team). */
  flag: string | null
  /** The entry's own country (location_country) — wins over the linked club's. */
  locationFlag?: string | null
  /** Own mode: opens the entry. Omitted = public, read-only. */
  onOpen?: () => void
}

export function CareerEntryItem({ entry, last, flag, locationFlag = null, onOpen }: CareerEntryItemProps) {
  const isRep = entry.entryType === 'national_team'
  const span = careerSpan(entry)
  // The entry's own country first; the linked world club's can disagree with the club profile (QA 2 Oct).
  const metaFlag = locationFlag ?? entry.clubFlag ?? flag
  const metaText = [entry.locationCity?.trim() || entry.locationCountry?.trim() || null, span].filter(Boolean).join(' · ')
  const meta = [metaFlag, metaText].filter(Boolean).join(' ')
  const sub = [entry.positionRole?.trim() ? humanizeToken(entry.positionRole) : null, isRep ? 'representative team' : entry.divisionLeague?.trim() || null].filter(Boolean).join(' · ')
  const crest = entry.crestUrl ? getImageUrl(entry.crestUrl, 'avatar-sm') ?? entry.crestUrl : null
  const highlights = entry.highlights.slice(0, CAREER_ITEM_HIGHLIGHTS)
  const body = (
    <>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-row font-semibold text-ink-1">{entry.clubName}</p>
        {onOpen && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" data-testid="career-entry-chevron" />}
      </div>
      {sub && <p className="truncate text-secondary text-ink-2">{sub}</p>}
      {meta && <p className="truncate text-secondary text-ink-2">{meta}</p>}
      {entry.signedViaHockia && <SignedThroughHockiaPill className="mt-1" />}
      {highlights.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {highlights.map((h) => (
            <li key={h} className="flex items-start gap-2 text-secondary text-ink-1" data-testid="career-entry-highlight">
              <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-positive" strokeWidth={2.5} aria-hidden="true" /> <span className="min-w-0">{h}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
  return (
    <li className="flex gap-3" data-testid="career-entry-item" data-mode={onOpen ? 'own' : 'public'}>
      <div className="flex w-10 shrink-0 flex-col items-center">
        {crest ? (
          <EntityAvatar src={crest} name={entry.clubName} role="club" size={40} />
        ) : (
          <span className="block h-10 w-10 shrink-0 rounded-[10px] border border-line bg-surface-muted" aria-hidden="true" data-testid="career-entry-placeholder" />
        )}
        {!last && <span className="mt-1 w-px flex-1 bg-line" data-testid="career-entry-line" />}
      </div>
      {onOpen ? (
        <button type="button" onClick={onOpen} className={cn('min-h-[44px] min-w-0 flex-1 text-left', !last && 'pb-5')}>{body}</button>
      ) : (
        <div className={cn('min-w-0 flex-1', !last && 'pb-5')}>{body}</div>
      )}
    </li>
  )
}
