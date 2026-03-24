import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { ChevronRight, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { Avatar, RoleBadge } from '@/components'
import type { Database } from '@/lib/database.types'

type ClubMember = Database['public']['Functions']['get_club_members']['Returns'][number]

interface ClubMembersTabProps {
  profileId: string
}

const PAGE_SIZE = 30

/** Build a compact secondary line: position · location */
function buildMeta(member: ClubMember): string {
  const parts: string[] = []
  if (member.position) parts.push(member.position.charAt(0).toUpperCase() + member.position.slice(1))
  if (member.base_location) parts.push(member.base_location)
  return parts.join(' · ')
}

export default function ClubMembersTab({ profileId }: ClubMembersTabProps) {
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useAuthStore()
  const { addToast } = useToastStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false

  const [members, setMembers] = useState<ClubMember[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMembers = useCallback(async (offset: number): Promise<ClubMember[] | null> => {
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'club_members.fetch',
      data: { profileId, offset, limit: PAGE_SIZE },
      level: 'info',
    })

    const { data, error: rpcError } = await supabase.rpc('get_club_members', {
      p_profile_id: profileId,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    })

    if (rpcError) {
      logger.error('Error fetching club members:', rpcError)
      reportSupabaseError('club_members.fetch', rpcError, {
        profileId,
        offset,
      }, {
        feature: 'club_members',
        operation: 'fetch_members',
      })
      return null
    }

    return data
  }, [profileId])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      const data = await fetchMembers(0)
      if (cancelled) return

      if (data === null) {
        setError('Failed to load members. Please try again.')
        setMembers([])
        setTotalCount(0)
      } else if (data.length > 0) {
        setMembers(data)
        setTotalCount(data[0].total_count)
      } else {
        setMembers([])
        setTotalCount(0)
      }
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [fetchMembers])

  const handleLoadMore = async () => {
    setLoadingMore(true)
    const data = await fetchMembers(members.length)
    if (data === null) {
      addToast('Failed to load more members. Please try again.', 'error')
    } else if (data.length > 0) {
      setMembers((prev) => [...prev, ...data])
      setTotalCount(data[0].total_count)
    }
    setLoadingMore(false)
  }

  const handleRetry = () => {
    setError(null)
    setLoading(true)
    void fetchMembers(0).then((data) => {
      if (data === null) {
        setError('Failed to load members. Please try again.')
        setMembers([])
        setTotalCount(0)
      } else if (data.length > 0) {
        setMembers(data)
        setTotalCount(data[0].total_count)
      } else {
        setMembers([])
        setTotalCount(0)
      }
      setLoading(false)
    })
  }

  // Filter out test accounts unless current user is also a test account
  const displayedMembers = isCurrentUserTestAccount
    ? members
    : members.filter((m) => !m.is_test_account)

  const hasMore = members.length < totalCount

  // ── Loading skeleton (list rows) ──────────────────────────────────
  if (loading) {
    return (
      <div className="divide-y divide-gray-100">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-3 px-1 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-32" />
              <div className="h-3 bg-gray-100 rounded w-48" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-600">
        <p>{error}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-2 px-4 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded-md transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────
  if (displayedMembers.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Users className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No members yet</h3>
        <p className="text-gray-500 text-sm max-w-sm mx-auto">
          Players and coaches who assign this club in their profile will appear here.
        </p>
      </div>
    )
  }

  // ── Members list ──────────────────────────────────────────────────
  return (
    <>
      <div className="divide-y divide-gray-100">
        {displayedMembers.map((member) => {
          const meta = buildMeta(member)
          return (
            <button
              key={member.id}
              type="button"
              onClick={() => navigate(`/players/id/${member.id}?ref=club-members`)}
              className="w-full flex items-center gap-3 py-3 px-1 text-left hover:bg-gray-50 rounded-lg transition-colors"
              data-testid="member-row"
            >
              <Avatar
                src={member.avatar_url}
                alt={member.full_name}
                initials={member.full_name ? member.full_name.split(' ').map(n => n[0]).join('') : '?'}
                size="md"
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm truncate">{member.full_name}</span>
                  <RoleBadge role={member.role as 'player' | 'coach'} />
                </div>
                {meta && (
                  <p className="text-sm text-gray-500 truncate mt-0.5">{meta}</p>
                )}
              </div>

              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </button>
          )
        })}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-8 py-3 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </>
  )
}
