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

import { useNavigate } from 'react-router-dom'
import {
  Bookmark, BookmarkCheck, MessageSquare, Send, BarChart3,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
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
  className?: string
}

export default function QuickActionsRow({
  playerId,
  playerName,
  compact = false,
  onMessage,
  className = '',
}: QuickActionsRowProps) {
  const { profile: viewer } = useAuthStore()
  const navigate = useNavigate()
  const savedState = useIsProfileSaved(playerId)

  const viewerRole = viewer?.role
  const isRecruiter = viewerRole === 'club' || viewerRole === 'coach'
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
    navigate(`/messages?new=${playerId}`)
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

      {/* Invite + Compare are recruiter-only placeholders (Spec G.5 /
          Phase 2). Hidden for non-recruiters; disabled with tooltips
          for recruiters until the underlying flows ship. */}
      {isRecruiter && (
        <ActionButton
          compact={compact}
          disabled
          onClick={() => {}}
          label={`Invite ${playerName} to apply (coming soon)`}
          title="Coming soon — invite players directly to your open opportunities"
          icon={Send}
          text="Invite"
        />
      )}

      {isRecruiter && (
        <ActionButton
          compact={compact}
          disabled
          onClick={() => {}}
          label="Compare (Phase 2)"
          title="Phase 2"
          icon={BarChart3}
          text="Compare"
        />
      )}

      <MoreActionsMenu
        playerId={playerId}
        playerName={playerName}
        compact={compact}
      />
    </div>
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
