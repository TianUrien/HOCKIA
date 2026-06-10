/**
 * QuickActionsRow — Spec G.5.
 *
 * Per-player action row for Community cards + profile pages.
 * Buttons:
 *   - Save / Saved — toggles the default shortlist (uses
 *     useIsProfileSaved which we extended in P1.5 to write into the
 *     default shortlist + create one on first save).
 *   - Message — navigates to /messages?new={playerId} (existing
 *     MessagesPage handles the "new conversation" deep link), unless
 *     a consumer passes a custom onMessage handler.
 *   - Invite to apply — DISABLED for now (recruiter-only; needs the
 *     opportunity_invitations table). Shows a "Coming soon" tooltip.
 *   - Compare — explicitly deferred to Phase 2 per spec.
 *   - ⋯ overflow — Move to list / Add note (rendered by the shared
 *     MoreActionsMenu so other recruiter surfaces can reuse it).
 *
 * Visibility: hidden for own-profile or anonymous viewers. Invite +
 * Compare are recruiter-only (club/coach). Save + Message + ⋯ are
 * available to any authenticated non-self viewer.
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { Bookmark, BookmarkCheck, MessageSquare, UserPlus, UserCheck, Clock } from 'lucide-react'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
import { useFriendship } from '@/hooks/useFriendship'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import MoreActionsMenu from './MoreActionsMenu'

interface QuickActionsRowProps {
  playerId: string
  /** Display name for accessibility labels + toast copy. */
  playerName: string
  /** Compact variant for tile-style cards (icon-only buttons). */
  compact?: boolean
  /** Optional custom Message handler. When provided, called instead
   *  of the default `navigate('/messages?new=<id>')`. Surfaces like
   *  MemberPreviewModal pass this to preserve their bespoke
   *  conversation-resolution logic (existing conversation lookup +
   *  in-flight cancellation) which is smarter than the naïve deep
   *  link.
   */
  onMessage?: () => void
  /** Show an Add-friend action (Add friend / Requested / Friends) between
   *  Message and ⋯. Used by the Preview so its actions match the recruiter
   *  card's Save · Message · Add friend. Off by default to keep the compact
   *  tiles uncluttered. */
  showAddFriend?: boolean
  className?: string
}

export default function QuickActionsRow({
  playerId,
  playerName,
  compact = false,
  onMessage,
  showAddFriend = false,
  className = '',
}: QuickActionsRowProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const savedState = useIsProfileSaved(playerId)

  if (savedState.isOwnProfile) return null
  if (!savedState.isAuthenticated) {
    // Anonymous viewer — render nothing. Auth-gated CTAs would just
    // toast "sign in" anyway; better to hide them entirely so the
    // surface stays uncluttered for browsers.
    return null
  }

  const handleMessage = () => {
    if (onMessage) {
      trackDbEvent('quick_action.message_clicked', 'profile', playerId, { source: 'custom' })
      onMessage()
      return
    }
    // returnTo: conversation back button returns to the page that
    // hosted this quick-actions row (typically /community or a
    // profile). Without this, back drops the user on the inbox.
    const returnTo = location.pathname + location.search
    navigate(`/messages?new=${playerId}`, { state: { returnTo } })
    trackDbEvent('quick_action.message_clicked', 'profile', playerId)
  }

  const labelSave = savedState.isSaved
    ? `Remove ${playerName} from saved`
    : `Save ${playerName}`

  return (
    <div className={['inline-flex items-center gap-1', className].join(' ')}>
      <ActionButton
        compact={compact}
        active={savedState.isSaved}
        onClick={() => void savedState.toggle()}
        disabled={savedState.mutating}
        label={labelSave}
        icon={savedState.isSaved ? BookmarkCheck : Bookmark}
        text={savedState.isSaved ? 'Saved' : 'Save'}
      />

      <ActionButton
        compact={compact}
        onClick={handleMessage}
        label={`Message ${playerName}`}
        icon={MessageSquare}
        text="Message"
      />

      {showAddFriend && (
        <AddFriendAction playerId={playerId} playerName={playerName} compact={compact} />
      )}

      <MoreActionsMenu
        playerId={playerId}
        playerName={playerName}
        compact={compact}
      />
    </div>
  )
}

/** Add-friend action — its own component so useFriendship only fetches the
 *  relationship when the consumer opts in (showAddFriend), not for every
 *  compact tile. Reuses the same hook + states as FriendshipButton. */
function AddFriendAction({ playerId, playerName, compact }: { playerId: string; playerName: string; compact: boolean }) {
  const { addToast } = useToastStore()
  const { mutating, isAuthenticated, isOwnProfile, isFriend, isOutgoingRequest, sendRequest } =
    useFriendship(playerId)
  if (isOwnProfile) return null
  if (isFriend) {
    return <ActionButton compact={compact} active disabled icon={UserCheck} text="Friends" label={`Friends with ${playerName}`} onClick={() => {}} />
  }
  if (isOutgoingRequest) {
    return <ActionButton compact={compact} disabled icon={Clock} text="Requested" label={`Friend request sent to ${playerName}`} onClick={() => {}} />
  }
  return (
    <ActionButton
      compact={compact}
      disabled={mutating}
      icon={UserPlus}
      text="Add friend"
      label={`Add ${playerName} as a friend`}
      onClick={() =>
        isAuthenticated
          ? void sendRequest()
          : addToast('Sign in with your HOCKIA profile to connect.', 'error')
      }
    />
  )
}

interface ActionButtonProps {
  icon: typeof Bookmark
  text: string
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  compact?: boolean
}

function ActionButton({
  icon: Icon, text, label, title, onClick, disabled = false, active = false, compact = false,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={[
        'inline-flex items-center gap-1 rounded-md transition-colors',
        compact ? 'p-1.5' : 'px-2.5 py-1.5 text-xs font-medium',
        active
          ? 'text-[#8026FA] bg-[#8026FA]/10 hover:bg-[#8026FA]/15'
          : 'text-gray-700 hover:text-[#8026FA] hover:bg-[#8026FA]/5',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-gray-700',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
      ].filter(Boolean).join(' ')}
    >
      <Icon className={compact ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      {!compact && <span>{text}</span>}
    </button>
  )
}
