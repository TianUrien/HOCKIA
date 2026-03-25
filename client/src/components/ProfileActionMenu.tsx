import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, Flag, Ban, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import ReportUserModal from './ReportUserModal'

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
  const menuRef = useRef<HTMLDivElement>(null)

  // Check if already blocked
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).rpc('is_user_blocked', { p_other_id: targetId })
      .then(({ data }: { data: boolean }) => { if (data) setBlocked(true) })
      .catch(() => {})
  }, [user, targetId])

  // Close menu on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="More actions"
        >
          <MoreVertical className="w-5 h-5 text-gray-500" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
            <button
              type="button"
              onClick={() => { setOpen(false); setShowReport(true) }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Flag className="w-4 h-4 text-gray-400" />
              Report User
            </button>
            <button
              type="button"
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
          </div>
        )}
      </div>

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
                className="flex-1 py-2.5 bg-[#8026FA] text-white rounded-lg text-sm font-medium hover:bg-[#6b1fd4] transition-colors disabled:opacity-50"
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
