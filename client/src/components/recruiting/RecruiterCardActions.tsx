/**
 * RecruiterCardActions — the explicit, text-labelled action footer for the
 * premium RecruiterCandidateCard: Save · Message · Add friend · ⋯.
 *
 * Unlike the icon-only QuickActionsRow (compact tiles), every action here
 * carries a word — recruiters never guess what a button does. Reuses the
 * same hooks as the rest of the app (useIsProfileSaved, useFriendship,
 * MoreActionsMenu) so behaviour matches everywhere; only the layout is
 * bespoke. Hidden for anonymous viewers + own profile.
 */
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Bookmark, BookmarkCheck, MessageSquare, UserPlus, UserCheck, Clock, Loader2,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
import { useFriendship } from '@/hooks/useFriendship'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'

interface RecruiterCardActionsProps {
  playerId: string
  playerName: string
  /** Custom Message handler (e.g. preview modal's conversation resolver).
   *  Falls back to navigate('/messages?new=<id>') when omitted. */
  onMessage?: () => void
}

export default function RecruiterCardActions({ playerId, playerName, onMessage }: RecruiterCardActionsProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const saved = useIsProfileSaved(playerId)

  if (saved.isOwnProfile || !saved.isAuthenticated) return null

  const handleMessage = () => {
    if (onMessage) {
      trackDbEvent('quick_action.message_clicked', 'profile', playerId, { source: 'recruiter_card' })
      onMessage()
      return
    }
    const returnTo = location.pathname + location.search
    navigate(`/messages?new=${playerId}`, { state: { returnTo } })
    trackDbEvent('quick_action.message_clicked', 'profile', playerId, { source: 'recruiter_card' })
  }

  return (
    <div className="flex items-stretch border-t border-gray-100">
      <ActionItem
        label={saved.isSaved ? 'Saved' : 'Save'}
        icon={saved.isSaved ? BookmarkCheck : Bookmark}
        active={saved.isSaved}
        disabled={saved.mutating}
        onClick={() => void saved.toggle()}
        ariaLabel={saved.isSaved ? `Remove ${playerName} from saved` : `Save ${playerName}`}
      />
      <ActionItem
        label="Chat"
        icon={MessageSquare}
        onClick={handleMessage}
        ariaLabel={`Message ${playerName}`}
      />
      <AddFriendItem playerId={playerId} playerName={playerName} />
    </div>
  )
}

/** Add-friend action — its own component so useFriendship only fetches the
 *  relationship when this footer actually renders (not for every tile). */
function AddFriendItem({ playerId, playerName }: { playerId: string; playerName: string }) {
  const { addToast } = useToastStore()
  const { loading, mutating, isAuthenticated, isOwnProfile, isFriend, isOutgoingRequest, sendRequest } =
    useFriendship(playerId)

  if (isOwnProfile) return null

  if (loading) {
    return <ActionItem label="Add friend" icon={Loader2} iconSpin disabled onClick={() => {}} ariaLabel="Loading friendship status" />
  }
  if (isFriend) {
    return <ActionItem label="Friends" icon={UserCheck} active disabled onClick={() => {}} ariaLabel={`Friends with ${playerName}`} />
  }
  if (isOutgoingRequest) {
    return <ActionItem label="Requested" icon={Clock} disabled onClick={() => {}} ariaLabel={`Friend request sent to ${playerName}`} />
  }
  return (
    <ActionItem
      label="Add friend"
      icon={UserPlus}
      disabled={mutating}
      iconSpin={mutating}
      onClick={() =>
        isAuthenticated
          ? void sendRequest()
          : addToast('Sign in with your HOCKIA profile to connect.', 'error')
      }
      ariaLabel={`Add ${playerName} as a friend`}
    />
  )
}

interface ActionItemProps {
  label: string
  icon: ComponentType<{ className?: string }>
  ariaLabel: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  iconSpin?: boolean
}

function ActionItem({ label, icon: Icon, ariaLabel, onClick, active = false, disabled = false, iconSpin = false }: ActionItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={[
        // Fixed row height (min-h-[52px]) so the footer is the SAME height on
        // every card regardless of which label/state shows — a wrapping
        // "Add friend" used to make this taller than a 1-word "Friends"/
        // "Requested", knocking the bottom action row out of alignment.
        // Icon stacked above the label on every width (the 2-up community
        // cards stay narrow), giving each button a ≥44px square tap target.
        'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8026FA]/40',
        active ? 'text-[#8026FA]' : 'text-gray-600 hover:text-[#8026FA] hover:bg-[#8026FA]/5',
        disabled && !active ? 'opacity-50 cursor-default hover:bg-transparent hover:text-gray-600' : '',
      ].join(' ')}
    >
      {/* Icon over label on the narrow 2-up mobile cards (keeps the full
          word readable), icon beside label on wider desktop cards.
          whitespace-nowrap guarantees a single line — no wrap-induced
          height variance between "Add friend" and "Friends"/"Requested". */}
      <Icon className={`h-4 w-4 flex-shrink-0 ${iconSpin ? 'animate-spin' : ''}`} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
