/**
 * QuickActionsRow — Spec G.5.
 *
 * Per-player action row for Community cards + profile pages.
 * Buttons:
 *   - Save / Saved — toggles the default shortlist (uses
 *     useIsProfileSaved which we extended in P1.5 to write into the
 *     default shortlist + create one on first save).
 *   - Message — navigates to /messages?new={playerId} (existing
 *     MessagesPage handles the "new conversation" deep link).
 *   - Invite to apply — DISABLED for now. Spec says "only when
 *     active opportunity exists for the owner"; the
 *     opportunity_invitations table + flow isn't built yet.
 *     Shows a "Coming soon" tooltip so recruiters know it's
 *     planned.
 *   - Compare — explicitly deferred to Phase 2 per spec.
 *   - ⋯ overflow menu — Move to list (opens MoveToShortlistMenu via
 *     the shortlist hook's add()), Add note (jumps to default-list
 *     detail page), Hide (deferred — needs a hide_profiles table).
 *
 * Recruiter-only visibility: this row hides entirely for player /
 * brand / umpire / anon viewers, mirroring ClubFitChip's contract.
 * Own-profile is also hidden (Save against yourself doesn't make
 * sense).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bookmark, BookmarkCheck, MessageSquare, Send, BarChart3, MoreHorizontal,
  FolderInput, Pencil,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
import { supabase } from '@/lib/supabase'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import MoveToShortlistMenu from './MoveToShortlistMenu'

interface QuickActionsRowProps {
  playerId: string
  /** Display name for accessibility labels + toast copy. */
  playerName: string
  /** Compact variant for tile-style cards (icon-only buttons). */
  compact?: boolean
  className?: string
}

export default function QuickActionsRow({
  playerId,
  playerName,
  compact = false,
  className = '',
}: QuickActionsRowProps) {
  const { profile: viewer } = useAuthStore()
  const navigate = useNavigate()
  const { addToast } = useToastStore()
  const savedState = useIsProfileSaved(playerId)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)

  // Outside-click close for the overflow menu.
  useEffect(() => {
    if (!overflowOpen) return
    const onDoc = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [overflowOpen])

  // Recruiter-only gate (mirrors ClubFitChip's contract).
  const viewerRole = viewer?.role
  if (viewerRole !== 'club' && viewerRole !== 'coach') return null
  if (savedState.isOwnProfile) return null

  const handleMessage = () => {
    if (!savedState.isAuthenticated) {
      addToast('Sign in to message players', 'error')
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
      {/* Save toggle — primary action. */}
      <ActionButton
        compact={compact}
        active={savedState.isSaved}
        onClick={() => void savedState.toggle()}
        disabled={savedState.mutating}
        label={labelSave}
        icon={savedState.isSaved ? BookmarkCheck : Bookmark}
        text={savedState.isSaved ? 'Saved' : 'Save'}
      />

      {/* Message — wires to existing /messages?new={id} deep link. */}
      <ActionButton
        compact={compact}
        onClick={handleMessage}
        label={`Message ${playerName}`}
        icon={MessageSquare}
        text="Message"
      />

      {/* Invite to apply — deferred. The opportunity_invitations
          table doesn't exist; spec G.5 makes this conditional on
          "an active opportunity exists for the owner" anyway, so
          surface as disabled with a tooltip rather than hiding it
          (recruiters need to know it's coming). */}
      <ActionButton
        compact={compact}
        disabled
        onClick={() => {}}
        label={`Invite ${playerName} to apply (coming soon)`}
        title="Coming soon — invite players directly to your open opportunities"
        icon={Send}
        text="Invite"
      />

      {/* Compare — explicitly Phase 2 per spec. */}
      <ActionButton
        compact={compact}
        disabled
        onClick={() => {}}
        label="Compare (Phase 2)"
        title="Phase 2"
        icon={BarChart3}
        text="Compare"
      />

      {/* Overflow: Move to list, Add note, Hide (deferred). */}
      <div ref={overflowRef} className="relative">
        <button
          type="button"
          onClick={() => setOverflowOpen((v) => !v)}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          className={[
            compact ? 'p-1.5' : 'px-2.5 py-1.5',
            'rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
          ].join(' ')}
        >
          <MoreHorizontal className={compact ? 'w-4 h-4' : 'w-4 h-4'} />
        </button>
        {overflowOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-30 w-52 rounded-xl border border-gray-200 bg-white shadow-xl py-1"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOverflowOpen(false); setMoveMenuOpen(true) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
            >
              <FolderInput className="w-4 h-4 text-gray-500" />
              Move to list…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOverflowOpen(false)
                // Jump to the default-list detail page; users can
                // expand the note textarea there. Wires through
                // navigate so the existing layout shows.
                navigate('/dashboard/shortlists')
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
            >
              <Pencil className="w-4 h-4 text-gray-500" />
              Add note in list
            </button>
            {/* Hide intentionally omitted until hide_profiles ships. */}
          </div>
        )}
        <MoveToAddMenu
          open={moveMenuOpen}
          onClose={() => setMoveMenuOpen(false)}
          playerId={playerId}
          playerName={playerName}
        />
      </div>
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

/**
 * "Move to list" from the overflow menu — when the player isn't
 * already in any list, this is effectively "Add to list". We add
 * a row to the picked shortlist via a direct insert (the
 * useShortlistItems hook is per-list and not the right shape here).
 */
interface MoveToAddMenuProps {
  open: boolean
  onClose: () => void
  playerId: string
  playerName: string
}
function MoveToAddMenu({ open, onClose, playerId, playerName }: MoveToAddMenuProps) {
  const { profile: viewer } = useAuthStore()
  const { addToast } = useToastStore()
  const handlePick = useCallback(async (shortlistId: string) => {
    if (!viewer?.id) return
    const { error } = await supabase
      .from('saved_profiles')
      .insert({
        owner_id: viewer.id,
        saved_profile_id: playerId,
        shortlist_id: shortlistId,
      })
    if (error) {
      // 23505 = already in this list → friendly toast.
      if (error.code === '23505') {
        addToast(`${playerName} is already in that list`, 'success')
        return
      }
      reportSupabaseError('QuickActionsRow.moveToAdd', error)
      addToast('Could not add to that list', 'error')
      return
    }
    trackDbEvent('shortlist.item_added', 'shortlist', shortlistId, {
      player_id: playerId,
      source: 'quick_actions',
    })
    addToast(`${playerName} added`, 'success')
  }, [viewer?.id, playerId, playerName, addToast])

  return (
    <MoveToShortlistMenu
      open={open}
      onClose={onClose}
      onPick={handlePick}
      title="Add to list…"
    />
  )
}
