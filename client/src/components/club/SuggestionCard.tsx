import { Check, Minus, Star } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { IconButton } from '@/components/ui/IconButton'
import { FitChip } from './FitChip'
import { InviteAction } from './InviteAction'
import { getImageUrl } from '@/lib/imageUrl'
import { personRoleLine } from '@/lib/clubRecruiting'
import type { InvitePill } from '@/lib/invites'
import type { RoleSuggestion } from '@/lib/roleSuggestions'
import type { ReasonLine } from '@/lib/suggestionReasons'

/**
 * Card / Suggestion (Figma "New-Hockia" D5.1 398:83): rank (ink-3), Avatar 48,
 * name, "role · positions · flags", the Fit badge (existing club-only
 * FitChip), up to 4 reason lines (met = green check, missing = grey dash —
 * never amber), then the card's two actions: Muted star = Shortlist (the
 * role's own list), Tonal "Invite" (InviteAction + InviteSheet and its
 * limits). No Primary per card.
 */
interface Props {
  suggestion: RoleSuggestion
  /** Display rank (1..5) after the server's live fences. */
  rank: number
  flags: string | null
  reasons: ReasonLine[]
  shortlisted: boolean
  onToggleShortlist: () => void
  invitePill: InvitePill | null
  inviteLimitReason: string | null
  onInvite: () => void
  onOpen: () => void
}

export function SuggestionCard({ suggestion: s, rank, flags, reasons, shortlisted, onToggleShortlist, invitePill, inviteLimitReason, onInvite, onOpen }: Props) {
  const avatar = s.avatar_url ? getImageUrl(s.avatar_url, 'avatar-md') ?? s.avatar_url : null
  const name = s.full_name || 'Player'
  const roleLine = personRoleLine({ role: s.role ?? 'player', position: s.position, secondaryPosition: s.secondary_position })
  return (
    <article className="rounded-card border border-line bg-white px-4 pb-3.5 pt-4" data-testid="suggestion-card" aria-label={`${rank}. ${name}`}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 text-left">
        <span className="w-3 shrink-0 pt-[14px] text-secondary font-semibold text-ink-3" data-testid="suggestion-rank">{rank}</span>
        <EntityAvatar src={avatar} name={s.full_name} role="player" size={48} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{name}</span>
          <span className="block truncate text-[14px] leading-[19px] text-ink-2">{[roleLine, flags].filter(Boolean).join(' · ')}</span>
          {(s.fit_state === 'green' || s.fit_state === 'yellow') && (
            <span className="block pt-1"><FitChip state={s.fit_state} /></span>
          )}
        </span>
      </button>

      {reasons.length > 0 && (
        <ul className="flex flex-col gap-1.5 pt-3" aria-label="Why Hockia suggests this player">
          {reasons.map((r) => (
            <li key={r.key} className="flex items-start gap-2" data-testid="suggestion-reason" data-kind={r.kind}>
              {r.kind === 'met'
                ? <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-positive" strokeWidth={2.4} aria-label="Met" />
                : <Minus className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={2.4} aria-label="Not on the profile" />}
              <span className={r.kind === 'met' ? 'text-[14px] leading-[19px] text-ink-1' : 'text-[14px] leading-[19px] text-ink-3'}>{r.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-3.5">
        <IconButton
          variant={shortlisted ? 'tonal' : 'muted'}
          label={shortlisted ? `Remove ${name} from the shortlist` : `Shortlist ${name}`}
          aria-pressed={shortlisted}
          onClick={onToggleShortlist}
          data-testid="suggestion-shortlist"
        >
          <Star className="h-[18px] w-[18px]" strokeWidth={2} fill={shortlisted ? 'currentColor' : 'none'} aria-hidden="true" />
        </IconButton>
        <InviteAction pill={invitePill} invitable limitReason={inviteLimitReason} onInvite={onInvite} />
      </div>
    </article>
  )
}
