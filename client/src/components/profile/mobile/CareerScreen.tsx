import { useState } from 'react'
import { Plus } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { buttonClassName } from '@/components/ui/buttonClasses'
import CareerEntryScreen from './CareerEntryScreen'
import { CareerEntryItem } from './CareerEntryItem'
import { useCareerTimeline, type CareerHistoryRow } from '@/hooks/useCareerTimeline'
import { useCountries } from '@/hooks/useCountries'
import { flagForCountryName } from '@/lib/careerCopy'

/**
 * Career — own / public (Figma 145:581 · 245:694): the complete timeline
 * the profile previews, with highlights. One screen, two modes: own rows
 * carry a chevron and open the entry, with a Secondary "+ Add an entry"
 * pinned at the bottom; public rows are read-only and not tappable. Rows are
 * List item / Career entry (`CareerEntryItem`).
 */
interface CareerScreenProps {
  profileId: string
  mode: 'own' | 'public'
  onBack: () => void
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
                <CareerEntryItem
                  key={e.id}
                  entry={e}
                  last={i === entries.length - 1}
                  flag={e.representedCountryId ? countries.find((c) => c.id === e.representedCountryId)?.flag_emoji ?? null : null}
                  locationFlag={flagForCountryName(countries, e.locationCountry)}
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
          <button type="button" onClick={() => setEditing(null)} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })} data-testid="career-add-entry">
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /> Add an entry
          </button>
        </div>
      )}
    </div>
  )
}
