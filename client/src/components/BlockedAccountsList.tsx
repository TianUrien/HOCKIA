import { useState, useEffect } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import Avatar from './Avatar'

interface BlockedUser {
  blocked_id: string
  created_at: string
  profile: {
    full_name: string | null
    username: string | null
    avatar_url: string | null
    role: string | null
  } | null
}

/**
 * Blocked Accounts list for Settings > Privacy.
 * Follows Instagram/Facebook pattern: shows all blocked users with unblock button.
 */
export default function BlockedAccountsList() {
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [unblocking, setUnblocking] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    fetchBlocked()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchBlocked = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('user_blocks')
        .select('blocked_id, created_at, profile:profiles!user_blocks_blocked_id_fkey(full_name, username, avatar_url, role)')
        .eq('blocker_id', user!.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setBlockedUsers((data ?? []) as unknown as BlockedUser[])
    } catch (err) {
      logger.error('Failed to fetch blocked users:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleUnblock = async (blockedId: string, name: string) => {
    setUnblocking(blockedId)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('unblock_user', { p_blocked_id: blockedId })
      if (error) throw error
      setBlockedUsers(prev => prev.filter(u => u.blocked_id !== blockedId))
      addToast(`${name} has been unblocked`, 'success')
    } catch (err) {
      logger.error('Unblock failed:', err)
      addToast('Failed to unblock. Please try again.', 'error')
    } finally {
      setUnblocking(null)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    )
  }

  if (blockedUsers.length === 0) {
    return (
      <div className="text-center py-4">
        <Ban className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No blocked accounts</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blockedUsers.map(({ blocked_id, profile: p }) => {
        const name = p?.full_name || p?.username || 'Unknown'
        return (
          <div key={blocked_id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <Avatar
              src={p?.avatar_url}
              initials={name.slice(0, 2)}
              size="sm"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
              {p?.role && <p className="text-xs text-gray-500 capitalize">{p.role}</p>}
            </div>
            <button
              type="button"
              onClick={() => handleUnblock(blocked_id, name)}
              disabled={unblocking === blocked_id}
              className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {unblocking === blocked_id ? 'Unblocking...' : 'Unblock'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
