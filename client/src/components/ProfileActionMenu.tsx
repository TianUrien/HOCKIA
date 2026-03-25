import { useState, useRef, useEffect } from 'react'
import { MoreVertical, Flag, Ban, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import ReportUserModal from './ReportUserModal'

interface ProfileActionMenuProps {
  targetId: string
  targetName: string
}

/**
 * Three-dot menu for public profiles with Report and Block actions.
 * Required by Apple Guideline 1.2 (Safety - User-Generated Content).
 */
export default function ProfileActionMenu({ targetId, targetName }: ProfileActionMenuProps) {
  const { user } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [showReport, setShowReport] = useState(false)
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
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any
      if (blocked) {
        const { error: err } = await sb.rpc('unblock_user', { p_blocked_id: targetId })
        if (err) throw err
        setBlocked(false)
      } else {
        const { error: err } = await sb.rpc('block_user', { p_blocked_id: targetId })
        if (err) throw err
        setBlocked(true)
      }
    } catch (err) {
      logger.error('Block/unblock failed:', err)
    } finally {
      setLoadingBlock(false)
      setOpen(false)
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
              onClick={handleBlock}
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
    </>
  )
}
