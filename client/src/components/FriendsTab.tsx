import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Users, UserPlus, Check, X, Loader2, UserMinus, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'
import type { Profile } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import ConfirmActionModal from './ConfirmActionModal'
import TrustedReferencesSection from './TrustedReferencesSection'
import type { ReferenceFriendOption } from './AddReferenceModal'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { trackReferenceModalOpen } from '@/lib/analytics'
import { getInitials } from '@/lib/utils'
import { profilePath } from '@/lib/profileNavigation'

interface FriendsTabProps {
  profileId: string
  readOnly?: boolean
  profileRole?: Profile['role'] | null
  /**
   * When true, the inline TrustedReferencesSection block is suppressed.
   * Set by dashboards that mount a separate "References" tab so the
   * references content lives in one place instead of being duplicated
   * at the top of the Friends tab.
   *
   * Default false preserves the legacy single-tab layout for any
   * caller that hasn't been migrated yet.
   */
  hideReferences?: boolean
}

type FriendStatus = Database['public']['Enums']['friendship_status']
type FriendEdge = Database['public']['Views']['profile_friend_edges']['Row']
type FriendProfile = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'role' | 'username' | 'base_location' | 'current_club'>

type FriendConnection = FriendEdge & {
  friend: FriendProfile | null
}

export default function FriendsTab({ profileId, readOnly = false, profileRole, hideReferences = false }: FriendsTabProps) {
  const { profile: authProfile } = useAuthStore()
  // Refresh the auth-store profile after friendship mutations so the
  // Hero credibility pills + Bento "My Network" counters reflect the
  // new accepted_friend_count without forcing a full page reload.
  // QA-flagged: accept/decline left the dashboard header reading
  // "Connections 0" until reload.
  const refreshAuthProfile = useAuthStore((s) => s.refreshProfile)
  const navigate = useNavigate()
  const { addToast } = useToastStore()
  // In readOnly mode, treat as non-owner even if viewing own profile
  const isOwner = !readOnly && authProfile?.id === profileId
  const [connections, setConnections] = useState<FriendConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [actionTarget, setActionTarget] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)

  // ?section= deep-link handler. Two recognised values today:
  //   - "incoming"   → scroll to Incoming Friend Requests (used by the
  //                    friend_request_received notification)
  //   - "references" → scroll to the inline TrustedReferencesSection
  //                    (legacy; only meaningful when hideReferences=false,
  //                    e.g. ClubDashboard which doesn't have a separate
  //                    ReferencesTab)
  // Reference notifications now route to ?tab=references directly and
  // never land on this tab, so the old "requests" / "accepted" mappings
  // were removed.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const trustedReferencesRef = useRef<HTMLDivElement | null>(null)
  const incomingRequestsRef = useRef<HTMLElement | null>(null)

  // Phase 4 References UX Plan #1.4 — per-friend "Ask to vouch" CTA. The
  // friend-row button sets this state to the target friend.id; the
  // TrustedReferencesSection mounted above watches this prop, opens its
  // AddReferenceModal pre-selected to that friend, then calls back via
  // onAddReferenceConsumed so we clear the signal (so the SAME friend can be
  // asked again after a withdraw without state-drift confusion).
  const [askVouchFor, setAskVouchFor] = useState<string | null>(null)
  // References can only be COLLECTED by player / coach / umpire (per
  // request_reference RPC). Hide the friend-row CTA for clubs and brands —
  // they can still be GIVEN references, but can't ask for them.
  const canAskForReferences =
    isOwner && (profileRole === 'player' || profileRole === 'coach' || profileRole === 'umpire')

  const fetchConnections = useCallback(async () => {
    setLoading(true)
    try {
      const { data: edges, error } = await supabase
        .from('profile_friend_edges')
        .select('*')
        .eq('profile_id', profileId)
        .neq('status', 'blocked')
        .order('status', { ascending: true })
        .order('created_at', { ascending: false })

      if (error) throw error

      const friendIds = Array.from(
        new Set(
          (edges ?? [])
            .map((edge) => edge.friend_id)
            .filter((id): id is string => Boolean(id))
        )
      )
      let profileMap = new Map<string, FriendProfile>()

      if (friendIds.length > 0) {
        const { data: friendProfiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, role, username, base_location, current_club')
          .in('id', friendIds)

        if (profileError) throw profileError
        profileMap = new Map(friendProfiles?.map((row) => [row.id, row as FriendProfile]))
      }

      const enriched = (edges ?? []).map((edge) => ({
        ...edge,
        friend: edge.friend_id ? profileMap.get(edge.friend_id) ?? null : null,
      }))

      setConnections(enriched)
    } catch (error) {
      logger.error('Failed to load friends', error)
      addToast('Unable to load friends. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }, [profileId, addToast])

  useEffect(() => {
    void fetchConnections()
  }, [fetchConnections])

  // Scroll the right section into view AFTER the connections fetch settles.
  // requestAnimationFrame so we scroll AFTER the new layout is committed
  // (avoids a flicker where the page briefly shows the top before scrolling).
  useEffect(() => {
    if (loading) return
    const section = requestedSection
    let target: HTMLElement | null = null
    if (section === 'incoming') {
      target = incomingRequestsRef.current
    } else if (section === 'references') {
      target = trustedReferencesRef.current
    }
    if (!target) return
    const id = requestAnimationFrame(() => {
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(id)
  }, [loading, requestedSection])

  const acceptedConnections = useMemo(
    () => connections.filter((connection) => connection.status === 'accepted'),
    [connections]
  )

  // Phase 3 (post-friendship prompt) — when ?ask=<friendId> deep-links into
  // FriendsTab (RecentlyConnectedCard CTA from the dashboard, or a stale
  // link a user pasted), seed the existing per-friend Ask flow and
  // immediately strip the param so a refresh doesn't re-open the modal.
  // Validate the id against the current accepted-friend list — a stale id
  // (friend unfriended, blocked, or already in pending/accepted refs) gets
  // a soft toast instead of a silently-empty modal.
  useEffect(() => {
    if (loading) return
    const friendId = searchParams.get('ask')
    if (!friendId || !canAskForReferences) return

    const isAcceptedFriend = acceptedConnections.some((c) => c.friend_id === friendId)
    if (isAcceptedFriend) {
      setAskVouchFor(friendId)
    } else {
      addToast(
        'That connection is no longer available. Pick someone from your list to send a reference request.',
        'info',
      )
    }
    const next = new URLSearchParams(searchParams)
    next.delete('ask')
    setSearchParams(next, { replace: true })
  }, [loading, searchParams, setSearchParams, canAskForReferences, acceptedConnections, addToast])

  const referenceFriendOptions = useMemo<ReferenceFriendOption[]>(() => {
    const options: ReferenceFriendOption[] = []
    const seen = new Set<string>()
    acceptedConnections.forEach((connection) => {
      const friend = connection.friend
      if (!friend?.id || seen.has(friend.id)) return
      seen.add(friend.id)
      options.push({
        id: friend.id,
        fullName: friend.full_name || friend.username || 'HOCKIA Member',
        username: friend.username,
        avatarUrl: friend.avatar_url,
        role: friend.role,
        baseLocation: friend.base_location,
        currentClub: friend.current_club ?? null,
        acceptedAt: connection.accepted_at ?? null,
      })
    })
    return options
  }, [acceptedConnections])

  const incomingRequests = useMemo(
    () => (isOwner ? connections.filter((connection) => connection.status === 'pending' && connection.requester_id !== profileId) : []),
    [connections, isOwner, profileId]
  )

  const outgoingRequests = useMemo(
    () => (isOwner ? connections.filter((connection) => connection.status === 'pending' && connection.requester_id === profileId) : []),
    [connections, isOwner, profileId]
  )

  const updateFriendship = useCallback(
    async (friendshipId: string | null, nextStatus: FriendStatus, successMessage: string) => {
      if (!friendshipId) return

      setActionTarget(friendshipId)
      try {
        const { error } = await supabase
          .from('profile_friendships')
          .update({ status: nextStatus })
          .eq('id', friendshipId)

        if (error) throw error
        addToast(successMessage, 'success')
        await fetchConnections()
        // Refresh the auth profile so accepted_friend_count flows back
        // into the Hero pills + My Network bento counters immediately.
        if (isOwner) {
          void refreshAuthProfile()
        }
      } catch (error) {
        logger.error('Failed to update friendship', error)
        addToast('Unable to update friendship. Please try again.', 'error')
      } finally {
        setActionTarget(null)
      }
    },
    [addToast, fetchConnections, isOwner, refreshAuthProfile]
  )

  // Remove an accepted connection. We use DELETE here, not UPDATE, because
  // the friendships RLS only lets the recipient set 'accepted/rejected/blocked',
  // not 'cancelled' — so an UPDATE with status='cancelled' silently affects
  // 0 rows when the current user is the recipient. The delete policy allows
  // both user_one and user_two, so DELETE works for both sides symmetrically.
  const removeFriendship = useCallback(
    async (friendshipId: string | null) => {
      if (!friendshipId) return
      setActionTarget(friendshipId)
      try {
        const { error } = await supabase
          .from('profile_friendships')
          .delete()
          .eq('id', friendshipId)
        if (error) throw error
        addToast('Connection removed.', 'success')
        await fetchConnections()
        // accepted_friend_count drops by one — refresh the auth profile
        // so the Hero pill / My Network bento counters track.
        if (isOwner) {
          void refreshAuthProfile()
        }
      } catch (error) {
        logger.error('Failed to remove friendship', error)
        addToast('Could not remove connection. Please try again.', 'error')
      } finally {
        setActionTarget(null)
      }
    },
    [addToast, fetchConnections, isOwner, refreshAuthProfile]
  )

  const isActionLoading = (friendshipId: string | null) => actionTarget === friendshipId


  const humanizeDate = (isoString?: string | null) => {
    if (!isoString) return 'just now'
    return formatDistanceToNow(new Date(isoString), { addSuffix: true })
  }

  const buildProfileLink = (friend: FriendProfile | null) => {
    if (!friend) return '#'
    // Brands key on brand.slug (not profiles.username), so the username
    // path won't resolve. Always go through the id-redirect, which looks
    // up the canonical slug and redirects to /brands/:slug.
    if (friend.role === 'brand') return `/brands/id/${friend.id}`
    // profilePath emits the right /<role>/... URL per role and falls back
    // to /<role>/id/<uuid> when username is missing. Prevents the
    // pre-fix bug where coach friends routed to /players/<slug>.
    return profilePath(friend.role, friend.username, friend.id) ?? '#'
  }

  const canShowTrustedReferences =
    isOwner || profileRole === 'player' || profileRole === 'coach' || profileRole === 'umpire'

  const renderFriendCard = (connection: FriendConnection, showActions = false) => (
    <div key={`${connection.id}-${connection.friend_id}`} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link to={buildProfileLink(connection.friend)} className="flex flex-1 items-center gap-3">
          <Avatar
            src={connection.friend?.avatar_url}
            initials={getInitials(connection.friend?.full_name || connection.friend?.username)}
            size="md"
            alt={connection.friend?.full_name || connection.friend?.username || undefined}
            enablePreview
            previewTitle={connection.friend?.full_name || connection.friend?.username || undefined}
            previewInteraction="pointer"
            role={connection.friend?.role}
          />
          <div>
            <p className="font-semibold text-gray-900">{connection.friend?.full_name || connection.friend?.username || 'HOCKIA Member'}</p>
            <RoleBadge role={connection.friend?.role ?? 'member'} className="mt-1" />
            {connection.friend?.base_location && (
              <p className="text-xs text-gray-500">{connection.friend.base_location}</p>
            )}
          </div>
        </Link>

        <div className="flex flex-col items-start gap-2 text-xs text-gray-500">
          {connection.accepted_at && <span>Connected {humanizeDate(connection.accepted_at)}</span>}
          {!connection.accepted_at && <span>Requested {humanizeDate(connection.created_at)}</span>}

          <div className="flex flex-wrap items-center gap-2">
            {/* Phase 4 References UX Plan #1.4 — per-friend "Ask to vouch" CTA.
                Only renders for accepted-friendship rows on owner-mode views,
                and only when the owner's role can collect references at all
                (player / coach / umpire). The button signals up to the parent
                via askVouchFor; the TrustedReferencesSection mounted above
                watches the same state and opens its modal pre-selected. */}
            {canAskForReferences && showActions && connection.friend_id && connection.accepted_at && (
              <button
                type="button"
                onClick={() => {
                  trackReferenceModalOpen('friend_row')
                  if (hideReferences) {
                    // Tab-split layout: references live on a separate tab,
                    // so cross-navigate via URL. The references tab reads
                    // ?ask=<id> and auto-opens the modal pre-filled.
                    const next = new URLSearchParams(searchParams)
                    next.set('tab', 'references')
                    next.set('ask', connection.friend_id ?? '')
                    next.delete('section')
                    setSearchParams(next, { replace: false })
                  } else {
                    setAskVouchFor(connection.friend_id)
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                title={`Ask ${connection.friend?.full_name ?? 'them'} to vouch for you on HOCKIA`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Ask to vouch
              </button>
            )}

            {showActions && connection.id && (
              <button
                type="button"
                disabled={isActionLoading(connection.id)}
                onClick={() =>
                  setRemoveTarget({
                    id: connection.id ?? '',
                    name:
                      connection.friend?.full_name ||
                      connection.friend?.username ||
                      'this connection',
                  })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isActionLoading(connection.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const renderRequestCard = (
    connection: FriendConnection,
    type: 'incoming' | 'outgoing'
  ) => (
    <div key={`${connection.id}-${connection.friend_id}`} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link to={buildProfileLink(connection.friend)} className="flex flex-1 items-center gap-3">
          <Avatar
            src={connection.friend?.avatar_url}
            initials={getInitials(connection.friend?.full_name || connection.friend?.username)}
            size="md"
            alt={connection.friend?.full_name || connection.friend?.username || undefined}
            enablePreview
            previewTitle={connection.friend?.full_name || connection.friend?.username || undefined}
            previewInteraction="pointer"
            role={connection.friend?.role}
          />
          <div>
            <p className="font-semibold text-gray-900">{connection.friend?.full_name || connection.friend?.username || 'HOCKIA Member'}</p>
            <RoleBadge role={connection.friend?.role ?? 'member'} className="mt-1" />
            <p className="text-xs text-gray-500">Requested {humanizeDate(connection.created_at)}</p>
          </div>
        </Link>

        <div className="flex flex-wrap gap-2">
          {type === 'incoming' ? (
            <>
              <button
                type="button"
                disabled={isActionLoading(connection.id)}
                onClick={() => void updateFriendship(connection.id, 'accepted', 'Connection request accepted.')}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isActionLoading(connection.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Accept
              </button>
              <button
                type="button"
                disabled={isActionLoading(connection.id)}
                onClick={() => void updateFriendship(connection.id, 'rejected', 'Connection request declined.')}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {isActionLoading(connection.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Reject
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isActionLoading(connection.id)}
              onClick={() => void updateFriendship(connection.id, 'cancelled', 'Connection request cancelled.')}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isActionLoading(connection.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Cancel Request
            </button>
          )}
        </div>
      </div>
    </div>
  )

  const renderEmptyState = (title: string, description: string, action?: ReactNode) => (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
        <Users className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="animate-pulse rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/2 rounded bg-gray-200" />
                <div className="h-3 w-1/3 rounded bg-gray-100" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {!hideReferences && canShowTrustedReferences && (
        <div
          ref={trustedReferencesRef}
          data-deeplink-section="trusted-references"
          // scroll-mt-[88px] gives smooth-scrolled targets headroom under any
          // sticky header so the section doesn't dock under it.
          className="scroll-mt-[88px]"
        >
          <TrustedReferencesSection
            profileId={profileId}
            friendOptions={referenceFriendOptions}
            profileRole={profileRole}
            readOnly={readOnly}
            openAddReferenceForFriendId={askVouchFor}
            onAddReferenceConsumed={() => setAskVouchFor(null)}
          />
        </div>
      )}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Connections</h2>
            <p className="text-sm text-gray-600">People in your HOCKIA network build credibility.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
              <Users className="h-4 w-4 text-[#8026FA]" />
              {acceptedConnections.length} {acceptedConnections.length === 1 ? 'connection' : 'connections'}
            </div>
            {/* Find people — header entry point for the owner once
                they already have connections. QA-flagged that there was
                no way to discover more coaches/clubs from a non-empty
                My Network. Gated on length > 0 so it doesn't duplicate
                the empty-state CTA below. */}
            {isOwner && acceptedConnections.length > 0 && (
              <button
                type="button"
                onClick={() => navigate('/community')}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#8026FA]/20 bg-white px-3 py-1 text-sm font-semibold text-[#8026FA] hover:bg-[#8026FA]/5 transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                Find people
              </button>
            )}
          </div>
        </div>
      </section>

      {isOwner && (
        <section
          ref={incomingRequestsRef}
          data-deeplink-section="incoming-requests"
          className="space-y-6 scroll-mt-[88px]"
        >
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Requests</h3>
            <p className="text-sm text-gray-500">Approve or decline pending requests from other members.</p>
          </div>
          {incomingRequests.length === 0
            ? renderEmptyState('No new requests right now', 'Pending requests will show up here.')
            : (
              <div className="space-y-4">
                {incomingRequests.map((connection) => renderRequestCard(connection, 'incoming'))}
              </div>
            )}
        </section>
      )}

      {isOwner && (
        <section className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Sent</h3>
            <p className="text-sm text-gray-500">Track connection requests you&apos;ve sent.</p>
          </div>
          {outgoingRequests.length === 0
            ? renderEmptyState('No pending requests', 'You haven\'t sent any connection requests yet.')
            : (
              <div className="space-y-4">
                {outgoingRequests.map((connection) => renderRequestCard(connection, 'outgoing'))}
              </div>
            )}
        </section>
      )}

      <section className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Connections</h3>
          <p className="text-sm text-gray-500">Visible to all HOCKIA members for transparency.</p>
        </div>

        {acceptedConnections.length === 0
          ? renderEmptyState(
              readOnly ? 'No connections listed yet' : 'No connections yet',
              readOnly
                ? 'This member hasn\'t added any connections yet.'
                : 'Build your network by connecting with players, coaches, and clubs.',
              readOnly
                ? undefined
                : (
                    <button
                      type="button"
                      onClick={() => navigate('/community')}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <UserPlus className="h-4 w-4" />
                      Find people
                    </button>
                  )
            )
          : (
            <div className="space-y-4">
              {acceptedConnections.map((connection) => renderFriendCard(connection, isOwner))}
            </div>
          )}
      </section>

      <ConfirmActionModal
        isOpen={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (!removeTarget) return
          await removeFriendship(removeTarget.id)
          setRemoveTarget(null)
        }}
        title="Remove connection"
        description={
          removeTarget
            ? `${removeTarget.name} will be removed from your connections. You can always reconnect later.`
            : ''
        }
        confirmLabel="Remove connection"
        confirmTone="danger"
        confirmLoading={Boolean(removeTarget && actionTarget === removeTarget.id)}
        loadingLabel="Removing..."
      />
    </div>
  )
}
