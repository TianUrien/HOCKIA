/**
 * Feed filter chips (Home V2 Phase 3, §2.6): ONE level of navigation —
 * All / Near you / Players / Clubs / Opportunities / Photos. The old
 * For You / Following / Reels sub-tabs stay cut (no follow graph).
 *
 * Chip semantics (documented data realities):
 *  - Near you  → server filter on AUTHOR NATIONALITY vs the viewer's country
 *    (base country first, nationality fallback) — the feed's only geo signal.
 *    Hidden when the viewer has no country on file.
 *  - Players/Clubs → server author-role filter.
 *  - Opportunities → server item-type filter.
 *  - Photos → CLIENT-side (no server predicate spans user-post images +
 *    photo-aggregate cards); pages may fill unevenly, infinite scroll tops up.
 */
export type FeedChip = 'all' | 'near' | 'players' | 'clubs' | 'opportunities' | 'photos'

const CHIP_LABELS: Record<FeedChip, string> = {
  all: 'All',
  near: 'Near you',
  players: 'Players',
  clubs: 'Clubs',
  opportunities: 'Opportunities',
  photos: 'Photos',
}

export function FeedFilterChips({ active, onChange, showNearYou }: {
  active: FeedChip
  onChange: (chip: FeedChip) => void
  showNearYou: boolean
}) {
  const chips = (Object.keys(CHIP_LABELS) as FeedChip[]).filter(
    (c) => c !== 'near' || showNearYou,
  )
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-pressed={active === c}
          className={`flex-shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            active === c
              ? 'bg-hockia-primary text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {CHIP_LABELS[c]}
        </button>
      ))}
    </div>
  )
}
