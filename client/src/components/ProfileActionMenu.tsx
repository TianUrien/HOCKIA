import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, Flag, Ban, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { rememberBlockedPair, invalidatePublicProfileCache } from '@/lib/publicProfileCache'
import { notifyBlockListChanged } from '@/hooks/useBlockedUsers'
import { invalidateFriendshipEdges } from '@/hooks/friendshipEdgeCache'
import ReportUserModal from './ReportUserModal'

const MENU_WIDTH = 192 // w-48
const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 6

interface ProfileActionMenuProps {
  targetId: string
  targetName: string
}

/**
 * Three-dot menu for public profiles with Report and Block actions.
 * Follows Instagram/Facebook UX patterns:
 * - Confirmation dialog before blocking
 * - Toast feedback after block/unblock
 * - Navigate away after blocking (profile becomes unavailable)
 */
export default function ProfileActionMenu({ targetId, targetName }: ProfileActionMenuProps) {
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [showBlockConfirm, setShowBlockConfirm] = useState(false)
  const [showUnblockConfirm, setShowUnblockConfirm] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [loadingBlock, setLoadingBlock] = useState(false)
  // Menu is portaled to document.body so it escapes the profile card's
  // overflow + isn't constrained by the trigger's narrow wrapper. Position
  // is computed from the trigger's rect and clamped to the viewport so it
  // can never spill off-screen (the old `absolute right-0` made the 192px
  // menu extend left from a left-positioned button → off the left edge).
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const measure = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportW = window.innerWidth
    // Right-align the menu to the button's right edge, then clamp so the
    // left edge never goes past VIEWPORT_PADDING and the right edge never
    // spills past the screen.
    const desiredLeft = rect.right - MENU_WIDTH
    const maxLeft = viewportW - MENU_WIDTH - VIEWPORT_PADDING
    const left = Math.max(VIEWPORT_PADDING, Math.min(desiredLeft, maxLeft))
    const top = rect.bottom + ANCHOR_GAP
    setPos({ top, left })
  }, [])

  // Check if already blocked
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).rpc('is_user_blocked', { p_other_id: targetId })
      .then(({ data }: { data: boolean }) => { if (data) setBlocked(true) })
      .catch(() => {})
  }, [user, targetId])

  // Measure synchronously before paint when opening so there's no flash
  // at a stale position.
  useLayoutEffect(() => {
    if (open) measure()
    else setPos(null)
  }, [open, measure])

  // Re-measure on scroll / resize while open (rAF-coalesced to avoid
  // layout thrash — same pattern as ClubFitChip / SettingsSheet).
  useEffect(() => {
    if (!open) return
    let rafId: number | null = null
    const onChange = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        measure()
      })
    }
    window.addEventListener('scroll', onChange, true)
    window.addEventListener('resize', onChange)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
    }
  }, [open, measure])

  // Close on outside click + Escape. Checks both the trigger and the
  // portaled menu so clicking inside the menu doesn't close it.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      const inButton = buttonRef.current?.contains(target) ?? false
      const inMenu = menuRef.current?.contains(target) ?? false
      if (!inButton && !inMenu) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  const handleBlock = async () => {
    setLoadingBlock(true)
    setShowBlockConfirm(false)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).rpc('block_user', { p_blocked_id: targetId })
      if (err) throw err
      setBlocked(true)
      // Record the block + bust the target's cached row so its public profile can
      // never be served warm from cache to us on a revisit (it re-checks + hides).
      rememberBlockedPair(user.id, targetId, true)
      invalidatePublicProfileCache({ id: targetId })
      // Re-sync the feed's blocked-id set so this user's posts drop out
      // immediately instead of lingering until a reload.
      notifyBlockListChanged()
      // block_user() DELETEs the friendship row server-side; bust the shared
      // friendship-edge cache so any mounted card stops showing stale
      // "Friends"/"Pending" (Apple 1.2: a block must read as immediate).
      invalidateFriendshipEdges()
      addToast(`${targetName} has been blocked`, 'success')
      // Navigate away — this profile is now unavailable to us
      navigate(-1)
    } catch (err) {
      logger.error('Block failed:', err)
      addToast('Failed to block user. Please try again.', 'error')
    } finally {
      setLoadingBlock(false)
    }
  }

  const handleUnblock = async () => {
    setLoadingBlock(true)
    setShowUnblockConfirm(false)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).rpc('unblock_user', { p_blocked_id: targetId })
      if (err) throw err
      setBlocked(false)
      // Clear the cached block result so this profile becomes viewable again.
      rememberBlockedPair(user.id, targetId, false)
      notifyBlockListChanged()
      // Friendship was severed by the original block; refresh the shared edge
      // cache so re-add affordances reflect the true (non-friend) state.
      invalidateFriendshipEdges()
      addToast(`${targetName} has been unblocked`, 'success')
    } catch (err) {
      logger.error('Unblock failed:', err)
      addToast('Failed to unblock user. Please try again.', 'error')
    } finally {
      setLoadingBlock(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
      >
        <MoreVertical className="w-5 h-5 text-gray-500" />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-[9999] bg-white rounded-xl shadow-lg border border-gray-200 py-1 animate-fade-in"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); setShowReport(true) }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Flag className="w-4 h-4 text-gray-400" />
            Report User
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              if (blocked) setShowUnblockConfirm(true)
              else setShowBlockConfirm(true)
            }}
            disabled={loadingBlock}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {blocked ? (
              <>
                <ShieldCheck className="w-4 h-4 text-green-500" />
                Unblock User
              </>
            ) : (
              <>
                <Ban className="w-4 h-4 text-red-400" />
                Block User
              </>
            )}
          </button>
        </div>,
        document.body,
      )}

      {showReport && (
        <ReportUserModal
          targetId={targetId}
          targetName={targetName}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Block confirmation dialog */}
      {showBlockConfirm && (
        <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowBlockConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Block {targetName}?</h3>
            <p className="text-sm text-gray-600 mb-5">
              They won't be able to find your profile, see your posts, or message you.
              You won't see their content either. Any existing friendship will be removed.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowBlockConfirm(false)}
                className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBlock}
                disabled={loadingBlock}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {loadingBlock ? 'Blocking...' : 'Block'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unblock confirmation dialog */}
      {showUnblockConfirm && (
        <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowUnblockConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Unblock {targetName}?</h3>
            <p className="text-sm text-gray-600 mb-5">
              They'll be able to find your profile, see your posts, and message you again.
              If you want to be friends, you'll need to send a new friend request.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowUnblockConfirm(false)}
                className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnblock}
                disabled={loadingBlock}
                className="flex-1 py-2.5 bg-hockia-primary text-white rounded-lg text-sm font-medium hover:bg-[#6b1fd4] transition-colors disabled:opacity-50"
              >
                {loadingBlock ? 'Unblocking...' : 'Unblock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
