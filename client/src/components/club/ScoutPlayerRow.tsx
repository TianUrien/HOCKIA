import { useRef, type ReactNode } from 'react'
import { Clock, FileText, PlaySquare } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { FitChip } from './FitChip'
import { getImageUrl } from '@/lib/imageUrl'
import { personRoleLine } from '@/lib/clubRecruiting'
import { nationalityLine, rowFactsLine, type CountryLite, type ScoutRow } from '@/lib/findPlayers'
import { passportInputs } from '@/hooks/useProfileKeyFacts'
import type { Country } from '@/hooks/useCountries'

/**
 * One player row on Find players (D1.9) and Shortlist (D1.10): name, the
 * role line, the fit chip (club-only; grey = none) + nationalities, the
 * 30-second key facts (plays at + league, age, EU passport, availability),
 * then the evidence or source line. The whole row opens the profile; the
 * trailing slot holds the row's one action.
 */
interface Props {
  row: ScoutRow
  countries: Country[]
  /** The line under the facts; icon picks from its kind. */
  meta: { kind: 'video' | 'career' | 'active' | 'custom'; text: string; icon?: ReactNode } | null
  below?: ReactNode
  trailing: ReactNode
  onOpen: () => void
  onLongPress?: () => void
  testId?: string
}

const ICON = { video: PlaySquare, career: FileText, active: Clock } as const

export function ScoutPlayerRow({ row, countries, meta, below, trailing, onOpen, onLongPress, testId = 'scout-row' }: Props) {
  const nat = nationalityLine([row.nationality_country_id, row.nationality2_country_id], countries as CountryLite[])
  const facts = rowFactsLine({
    currentClub: row.current_club,
    league: row.league,
    age: row.age,
    passports: passportInputs([row.nationality_country_id, row.nationality2_country_id], countries),
    openToPlay: row.open_to_play,
    availableFrom: row.available_from,
    availabilityDuration: row.availabilityDuration,
  })
  const avatar = row.avatar_url ? getImageUrl(row.avatar_url, 'avatar-md') ?? row.avatar_url : null
  const Icon = meta && meta.kind !== 'custom' ? ICON[meta.kind] : null
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const startPress = () => {
    if (!onLongPress) return
    longPressed.current = false
    pressTimer.current = setTimeout(() => { longPressed.current = true; onLongPress() }, 500)
  }
  const endPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); pressTimer.current = null }

  return (
    <div className="flex items-center gap-3 py-3 pl-5 pr-3.5" data-testid={testId}>
      <button
        type="button"
        onClick={() => { if (longPressed.current) { longPressed.current = false; return } onOpen() }}
        onContextMenu={onLongPress ? (e) => { e.preventDefault(); onLongPress() } : undefined}
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onTouchMove={endPress}
        aria-haspopup={onLongPress ? 'menu' : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 text-left [-webkit-touch-callout:none]"
      >
        <EntityAvatar src={avatar} name={row.full_name} role="player" size={52} className="shrink-0 self-start" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{row.full_name || 'Player'}</span>
          <span className="block truncate text-[14px] leading-[19px] text-ink-2">
            {personRoleLine({ role: row.role, position: row.position, secondaryPosition: row.secondary_position })}
          </span>
          {(row.fitState === 'green' || row.fitState === 'yellow' || nat) && (
            <span className="flex items-center gap-2 pt-[3px]">
              <span className="shrink-0 whitespace-nowrap empty:hidden"><FitChip state={row.fitState} /></span>
              {nat && <span className="min-w-0 truncate text-secondary text-ink-2">{nat}</span>}
            </span>
          )}
          {facts && <span className="line-clamp-2 pt-[3px] text-secondary text-ink-2" data-testid="scout-row-facts">{facts}</span>}
          {meta && (
            <span className="flex items-start gap-1.5 pt-[3px] text-secondary text-ink-3">
              {meta.icon ?? (Icon ? <Icon className="mt-[2px] h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null)}
              <span className="line-clamp-2">{meta.text}</span>
            </span>
          )}
          {below}
        </span>
      </button>
      <span className="shrink-0">{trailing}</span>
    </div>
  )
}
