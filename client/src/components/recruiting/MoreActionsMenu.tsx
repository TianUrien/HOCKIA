/**
 * MoreActionsMenu — shared overflow ⋯ menu for recruiter surfaces.
 *
 * Two items:
 *   - Move to list… → opens MoveToShortlistMenu; on pick, inserts a
 *     row into saved_profiles for that list. 23505 (already in list)
 *     surfaces a friendly toast instead of an error.
 *   - Add note in list → navigates to /dashboard/shortlists so the
 *     user can expand the note textarea on the list detail page.
 *
 * Used by QuickActionsRow (compact action bar in tiles + modals) and
 * ScoutingCard (alongside the bespoke gradient Save/Message buttons on
 * the public profile). Keeping the menu in one place means the
 * Move-to-list flow stays identical across surfaces — copy, telemetry,
 * unique-constraint handling, and "+ New list" creation are wired
 * through MoveToShortlistMenu's existing implementation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, FolderInput, Pencil } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { supabase } from '@/lib/supabase'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import MoveToShortlistMenu from './MoveToShortlistMenu'

interface MoreActionsMenuProps {
  playerId: string
  playerName: string
  /** Compact (smaller padding) for tile/icon-bar surfaces. */
  compact?: boolean
}

/**
 * Single-open invariant across the whole page. Mirror of the
 * activeChipCloser pattern in ClubFitChip — opening menu B synchronously
 * evicts whoever was registered before, so two ⋯ menus can't be visible
 * at once. Document-mousedown outside-click handling alone wasn't
 * enough: the close-A state update raced React's open-B click and they
 * sometimes batched into the same render (Community grid F1 regression).
 */
let activeMenuCloser: (() => void) | null = null

function registerActiveMenu(close: () => void) {
  const previous = activeMenuCloser
  activeMenuCloser = close
  if (previous && previous !== close) {
    previous()
  }
}

function unregisterActiveMenu(close: () => void) {
  if (activeMenuCloser === close) {
    activeMenuCloser = null
  }
}

export default function MoreActionsMenu({
  playerId,
  playerName,
}: MoreActionsMenuProps) {
  const navigate = useNavigate()
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Stable close fn — re-registered on each open so the singleton always
  // points at the most recently opened menu's setter.
  const close = useCallback(() => setOverflowOpen(false), [])

  useEffect(() => {
    if (!overflowOpen) return
    registerActiveMenu(close)
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOverflowOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      unregisterActiveMenu(close)
    }
  }, [overflowOpen, close])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOverflowOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={overflowOpen}
        className={[
          'min-w-[44px] min-h-[44px] inline-flex items-center justify-center',
          'rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
        ].join(' ')}
      >
        <MoreHorizontal className="w-4 h-4" />
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
              navigate('/dashboard/shortlists')
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            <Pencil className="w-4 h-4 text-gray-500" />
            Add note in list
          </button>
        </div>
      )}
      <MoveToAddMenu
        open={moveMenuOpen}
        onClose={() => setMoveMenuOpen(false)}
        playerId={playerId}
        playerName={playerName}
      />
    </div>
  )
}

interface MoveToAddMenuProps {
  open: boolean
  onClose: () => void
  playerId: string
  playerName: string
}

/**
 * Add the player to the picked shortlist via a direct insert. The
 * useShortlistItems hook is per-list and not the right shape for "add
 * from elsewhere" — going through supabase directly here keeps the
 * call site small.
 */
function MoveToAddMenu({ open, onClose, playerId, playerName }: MoveToAddMenuProps) {
  const { profile: viewer } = useAuthStore()
  const { addToast } = useToastStore()

  const handlePick = useCallback(async (shortlistId: string, shortlistName: string) => {
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
        addToast(`${playerName} is already in ${shortlistName}`, 'success')
        return
      }
      reportSupabaseError('MoreActionsMenu.moveToAdd', error)
      addToast('Could not add to that list', 'error')
      return
    }
    trackDbEvent('shortlist.item_added', 'shortlist', shortlistId, {
      player_id: playerId,
      source: 'more_actions_menu',
    })
    addToast(`${playerName} added to ${shortlistName}`, 'success')
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
