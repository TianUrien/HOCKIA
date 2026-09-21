import { useState } from 'react'
import { Check, ChevronRight, Flag } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import CareerEntryScreen from './CareerEntryScreen'
import { useCareerTimeline, type CareerHistoryRow, type CareerTimelineEntry } from '@/hooks/useCareerTimeline'
import { useCountries } from '@/hooks/useCountries'
import { careerSpan } from '@/lib/careerCopy'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken } from '@/lib/identity'
import { cn } from '@/lib/utils'

/**
 * Career — own / public (Figma 145:581 · 245:694): the complete timeline
 * the profile previews, with highlights. One screen, two modes: own rows
 * carry a chevron and open the entry, with Add an entry pinned at the
 * bottom; public rows are read-only and not tappable.
 */
interface CareerScreenProps {
  profileId: string
  mode: 'own' | 'public'
  onBack: () => void
}

function Entry({ entry, last, flag, onOpen }: { entry: CareerTimelineEntry; last: boolean; flag: string | null; onOpen?: () => void }) {
  const isRep = entry.entryType === 'national_team'
  const span = careerSpan(entry)
  const metaFlag = entry.clubFlag ?? flag
  const metaText = [entry.locationCity?.trim() || entry.locationCountry?.trim() || null, span].filter(Boolean).join(' · ')
  const meta = [metaFlag, metaText].filter(Boolean).join(' ')
  const sub = [entry.positionRole?.trim() ? humanizeToken(entry.positionRole) : null, isRep ? 'representative team' : entry.divisionLeague?.trim() || null].filter(Boolean).join(' · ')
  const crest = entry.crestUrl ? getImageUrl(entry.crestUrl, 'avatar-sm') ?? entry.crestUrl : null
  const body = (
    <>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-row font-semibold text-ink-1">{entry.clubName}</p>
        {onOpen && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />}
      </div>
      {sub && <p className="truncate text-secondary text-ink-2">{sub}</p>}
      {meta && <p className="truncate text-secondary text-ink-3">{meta}</p>}
      {entry.highlights.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {entry.highlights.map((h) => (
            <li key={h} className="flex items-start gap-2 text-secondary text-ink-1">
              <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-positive" strokeWidth={2.5} /> <span className="min-w-0">{h}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
  return (
    <li className="flex gap-3">
      <div className="flex w-10 shrink-0 flex-col items-center">
        {isRep && !crest ? (
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-hockia-soft text-hockia-primary"><Flag className="h-[18px] w-[18px]" strokeWidth={2} /></span>
        ) : (
          <EntityAvatar src={crest} name={entry.clubName} role="club" size={40} />
        )}
        {!last && <span className="mt-1 w-px flex-1 bg-line" />}
      </div>
      {onOpen ? (
        <button type="button" onClick={onOpen} className={cn('min-w-0 flex-1 text-left', !last && 'pb-5')}>{body}</button>
      ) : (
        <div className={cn('min-w-0 flex-1', !last && 'pb-5')}>{body}</div>
      )}
    </li>
  )
}

export default function CareerScreen({ profileId, mode, onBack }: CareerScreenProps) {
  const own = mode === 'own'
  const { entries, loading, failed, refresh } = useCareerTimeline(profileId)
  const { countries } = useCountries()
  // undefined = timeline · null = new entry · row = editing that entry
  const [editing, setEditing] = useState<CareerHistoryRow | null | undefined>(undefined)
  const editingCrest = editing ? entries.find((e) => e.id === editing.id)?.crestUrl ?? null : null

  if (own && editing !== undefined) {
    const nextOrder = entries.reduce((max, e) => Math.max(max, e.row.display_order ?? 0), 0) + 1
    return (
      <CareerEntryScreen
        entry={editing}
        initialCrestUrl={editingCrest}
        nextDisplayOrder={nextOrder}
        onClose={(changed) => { setEditing(undefined); if (changed) refresh() }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-white pb-40 lg:hidden" data-testid={own ? 'career-screen-own' : 'career-screen-public'}>
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent="Profile" title="Career" onBack={onBack} />
      </div>
      <div className="px-5 pt-3">
        {loading ? (
          <ul aria-busy="true" className="space-y-5">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex gap-3"><span className="h-10 w-10 animate-pulse rounded-tile bg-surface-grouped" /><span className="flex-1 space-y-2"><span className="block h-3.5 w-40 animate-pulse rounded bg-surface-grouped" /><span className="block h-3 w-28 animate-pulse rounded bg-surface-grouped" /></span></li>
            ))}
          </ul>
        ) : failed ? (
          <p className="py-10 text-center text-row text-ink-2">Career could not be loaded. Go back and try again.</p>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{own ? 'No career entries yet' : 'No career entries to show'}</p>
            {own && <p className="mt-1 text-secondary text-ink-2">Add the clubs and teams you have played for.</p>}
          </div>
        ) : (
          <>
            <ul>
              {entries.map((e, i) => (
                <Entry
                  key={e.id}
                  entry={e}
                  last={i === entries.length - 1}
                  flag={e.representedCountryId ? countries.find((c) => c.id === e.representedCountryId)?.flag_emoji ?? null : null}
                  onOpen={own ? () => setEditing(e.row) : undefined}
                />
              ))}
            </ul>
            <p className="pt-5 text-caption text-ink-3">{entries.length === 1 ? '1 entry' : `${entries.length} entries`} · newest first</p>
          </>
        )}
      </div>
      {own && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 bg-gradient-to-t from-white via-white to-white/0 px-5 pb-3 pt-4 lg:hidden">
          <button type="button" onClick={() => setEditing(null)} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white">Add an entry</button>
        </div>
      )}
    </div>
  )
}
