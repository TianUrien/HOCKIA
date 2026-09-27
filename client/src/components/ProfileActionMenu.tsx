import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { MENU_ICON_CLASS } from '@/lib/report'
import { rememberBlockedPair, invalidatePublicProfileCache } from '@/lib/publicProfileCache'
import { notifyBlockListChanged } from '@/hooks/useBlockedUsers'
import { invalidateFriendshipEdges } from '@/hooks/friendshipEdgeCache'
import { MoreMenu, type MoreMenuItem } from '@/components/safety/MoreMenu'
import { useReportAction } from '@/components/safety/useReportAction'

interface ProfileActionMenuProps {
  targetId: string
  targetName: string
  /** Items above Report (e.g. the applicant review's Message / View full profile). */
  leadingItems?: MoreMenuItem[]
  /** Block / Unblock under Report. Off where the founder spec lists only Report. */
  showBlock?: boolean
  /** Trigger styling for the host (glass circle on a cover, plain in a nav bar). */
  triggerClassName?: string
  iconClassName?: string
}

/**
 * The "…" menu on someone else's profile (phone + desktop, every role):
 * [leading items] · Report · Block/Unblock. Never rendered on your own
 * profile. Follows Instagram/Facebook UX patterns:
 * - Confirmation dialog before blocking
 * - Toast feedback after block/unblock
 * - Navigate away after blocking (profile becomes unavailable)
 */
export default function ProfileActionMenu({ targetId, targetName, leadingItems = [], showBlock = true, triggerClassName, iconClassName }: ProfileActionMenuProps) {
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const navigate = useNavigate()
  const report = useReportAction({ targetId, subject: 'profile' })
  const [showBlockConfirm, setShowBlockConfirm] = useState(false)
  const [showUnblockConfirm, setShowUnblockConfirm] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [loadingBlock, setLoadingBlock] = useState(false)

  // Check if already blocked.
  //
  // Two things this has to get right, both of which it previously didn't:
  //
  // 1. Set the resolved value, not just `true`. This component is reused
  //    across profiles (same tree position, changing targetId), so a
  //    "true" that is never cleared carried over: after viewing a blocked
  //    profile, the NEXT profile's menu still offered "Unblock" and hid
  //    "Block" — so you could not block that person at all.
  // 2. Ignore a stale response. targetId can change while the RPC is in
  //    flight; without the guard the previous target's answer wins.
  useEffect(() => {
    if (!user) {
      setBlocked(false)
      return
    }
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).rpc('is_user_blocked', { p_other_id: targetId })
      .then(({ data }: { data: boolean }) => { if (!cancelled) setBlocked(Boolean(data)) })
      .catch(() => { if (!cancelled) setBlocked(false) })
    return () => { cancelled = true }
  }, [user, targetId])

  if (!user || user.id === targetId) return null

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

  const items: MoreMenuItem[] = [...leadingItems, report.item]
  if (showBlock) {
    items.push(blocked
      ? { key: 'unblock', label: 'Unblock', icon: <ShieldCheck className={MENU_ICON_CLASS} strokeWidth={1.8} />, disabled: loadingBlock, onSelect: () => setShowUnblockConfirm(true) }
      : { key: 'block', label: 'Block', icon: <Ban className={MENU_ICON_CLASS} strokeWidth={1.8} />, disabled: loadingBlock, destructive: true, onSelect: () => setShowBlockConfirm(true) })
  }

  return (
    <>
      <MoreMenu items={items} title={targetName} triggerClassName={triggerClassName} iconClassName={iconClassName} testId="profile-more-menu" />
      {report.sheet}

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
