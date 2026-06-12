import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { ChevronRight, UserPlus, Users, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { Avatar, RoleBadge } from '@/components'
import ConfirmDialog from '@/components/ConfirmDialog'
import InviteMembersModal from '@/components/club/InviteMembersModal'
import { getClubInvitations, removeClubMember, type ClubInvitation } from '@/lib/clubMembership'
import type { Database } from '@/lib/database.types'

type ClubMember = Database['public']['Functions']['get_club_members']['Returns'][number]

interface ClubMembersTabProps {
  profileId: string
  /** When true, render owner controls (invite, pending invites, remove). */
  isOwner?: boolean
}

const PAGE_SIZE = 30

/** Build a compact secondary line: position · location */
function buildMeta(member: ClubMember): string {
  const parts: string[] = []
  if (member.position) parts.push(member.position.charAt(0).toUpperCase() + member.position.slice(1))
  if (member.base_location) parts.push(member.base_location)
  return parts.join(' · ')
}

export default function ClubMembersTab({ profileId, isOwner = false }: ClubMembersTabProps) {
  const navigate = useNavigate()
  const { user, profile: currentUserProfile } = useAuthStore()
  const { addToast } = useToastStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  // On staging, test accounts are visible to QA — but only to signed-in
  // users. get_club_members is SECURITY DEFINER (bypasses RLS), so
  // without the Boolean(user) gate a logged-out visitor would see test
  // members. This mirrors the RPC layer's auth.role() <> 'anon' check.
  const showTestAccounts = Boolean(user) && (isCurrentUserTestAccount
    || Boolean(import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')))

  const [members, setMembers] = useState<ClubMember[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [pending, setPending] = useState<ClubInvitation[]>([])
  const [removeTarget, setRemoveTarget] = useState<ClubMember | null>(null)

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
      reportSupabaseError('club_members.fetch', rpcError, { profileId, offset }, {
        feature: 'club_members',
        operation: 'fetch_members',
      })
      return null
    }

    return data
  }, [profileId])

  const fetchPending = useCallback(async () => {
    if (!isOwner) return
    const data = await getClubInvitations(profileId)
    setPending(data)
  }, [isOwner, profileId])

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    const data = await fetchMembers(0)
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
  }, [fetchMembers])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadFirstPage()
      if (!cancelled) await fetchPending()
    })()
    return () => { cancelled = true }
  }, [loadFirstPage, fetchPending])

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

  const handleConfirmRemove = async () => {
    if (!removeTarget) return
    const res = await removeClubMember(removeTarget.id)
    if (res.success) {
      setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id))
      setTotalCount((c) => Math.max(0, c - 1))
      addToast(`${removeTarget.full_name ?? 'Member'} removed from the club.`, 'success')
    } else {
      addToast(res.error ?? 'Could not remove the member.', 'error')
      throw new Error('remove failed') // keep ConfirmDialog open
    }
  }

  const handleCancelInvite = async (invite: ClubInvitation) => {
    const res = await removeClubMember(invite.member_profile_id)
    if (res.success) {
      setPending((prev) => prev.filter((p) => p.club_member_id !== invite.club_member_id))
    } else {
      addToast(res.error ?? 'Could not cancel the invitation.', 'error')
    }
  }

  // Filter out test accounts — unless the viewer is a test account, or
  // we're on staging (where QA needs them visible).
  const displayedMembers = showTestAccounts ? members : members.filter((m) => !m.is_test_account)
  const hasMore = members.length < totalCount

  const heading = (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold text-gray-900">Members</h2>
      {isOwner && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#8026FA] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#6B20D4]"
          data-testid="invite-members-button"
        >
          <UserPlus className="w-4 h-4" />
          Invite
        </button>
      )}
    </div>
  )

  const inviteModal = isOwner && (
    <InviteMembersModal
      isOpen={inviteOpen}
      onClose={() => { setInviteOpen(false); void fetchPending() }}
      onInvited={() => void fetchPending()}
    />
  )

  const confirmRemove = (
    <ConfirmDialog
      isOpen={Boolean(removeTarget)}
      onClose={() => setRemoveTarget(null)}
      onConfirm={handleConfirmRemove}
      title="Remove this member?"
      message={`${removeTarget?.full_name ?? 'This member'} will be removed from your club roster.`}
      confirmLabel="Remove"
      variant="danger"
      testId="remove-member-confirm"
    />
  )

  // Pending invites subsection (owner only)
  const pendingSection = isOwner && pending.length > 0 && (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Pending invites</h3>
      <div className="divide-y divide-gray-100">
        {pending.map((inv) => (
          <div key={inv.club_member_id} className="flex items-center gap-3 py-2.5 px-1">
            <Avatar src={inv.avatar_url} alt={inv.full_name ?? ''} initials={inv.full_name ? inv.full_name.split(' ').map((n) => n[0]).join('') : '?'} size="md" role={inv.role as 'player' | 'coach'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 text-sm truncate">{inv.full_name}</span>
                <RoleBadge role={inv.role as 'player' | 'coach'} />
              </div>
              <p className="text-xs text-amber-600 mt-0.5">Invitation pending{inv.invited_via === 'link' ? ' · via link' : ''}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleCancelInvite(inv)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  // ── Loading skeleton ──────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        {heading}
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
        {inviteModal}
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────
  if (error) {
    return (
      <div>
        {heading}
        <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-600">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadFirstPage()}
            className="mt-2 px-4 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded-md transition-colors"
          >
            Try again
          </button>
        </div>
        {inviteModal}
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────
  if (displayedMembers.length === 0 && pending.length === 0) {
    return (
      <div>
        {heading}
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No members yet</h3>
          <p className="text-gray-500 text-sm max-w-sm mx-auto">
            {isOwner
              ? 'Invite players and coaches to build your club’s roster — they’ll appear here once they accept.'
              : 'Players and coaches who join this club will appear here.'}
          </p>
          {isOwner && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#8026FA] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6B20D4]"
            >
              <UserPlus className="w-4 h-4" />
              Invite members
            </button>
          )}
        </div>
        {inviteModal}
      </div>
    )
  }

  // ── Members list ──────────────────────────────────────────────────
  return (
    <div>
      {heading}
      {pendingSection}
      <div className="divide-y divide-gray-100">
        {displayedMembers.map((member) => {
          const meta = buildMeta(member)
          const canRemove = isOwner && member.is_roster_member
          return (
            <div key={member.id} className="flex items-center gap-1 group">
              <button
                type="button"
                onClick={() => navigate(
                  member.role === 'coach'
                    ? `/coaches/id/${member.id}?ref=club-members`
                    : `/players/id/${member.id}?ref=club-members`,
                )}
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-1 text-left hover:bg-gray-50 rounded-lg transition-colors"
                data-testid="member-row"
              >
                <Avatar
                  src={member.avatar_url}
                  alt={member.full_name}
                  initials={member.full_name ? member.full_name.split(' ').map((n) => n[0]).join('') : '?'}
                  size="md"
                  role={member.role}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm truncate">{member.full_name}</span>
                    <RoleBadge role={member.role as 'player' | 'coach'} />
                  </div>
                  {meta && <p className="text-sm text-gray-500 truncate mt-0.5">{meta}</p>}
                </div>
                {!canRemove && <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
              </button>
              {canRemove && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(member)}
                  aria-label={`Remove ${member.full_name ?? 'member'}`}
                  className="flex-shrink-0 p-2 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors md:opacity-0 md:group-hover:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
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

      {inviteModal}
      {confirmRemove}
    </div>
  )
}
