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
import TrustedReferencesSection from './TrustedReferencesSection'
import type { ReferenceFriendOption } from './AddReferenceModal'
import { Link, useSearchParams } from 'react-router-dom'
import { trackReferenceModalOpen } from '@/lib/analytics'

interface FriendsTabProps {
  profileId: string
  readOnly?: boolean
  profileRole?: Profile['role'] | null
}

type FriendStatus = Database['public']['Enums']['friendship_status']
type FriendEdge = Database['public']['Views']['profile_friend_edges']['Row']
type FriendProfile = Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'role' | 'username' | 'base_location' | 'current_club'>

type FriendConnection = FriendEdge & {
  friend: FriendProfile | null
}

export default function FriendsTab({ profileId, readOnly = false, profileRole }: FriendsTabProps) {
  const { profile: authProfile } = useAuthStore()
  const { addToast } = useToastStore()
  // In readOnly mode, treat as non-owner even if viewing own profile
  const isOwner = !readOnly && authProfile?.id === profileId
  const [connections, setConnections] = useState<FriendConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [actionTarget, setActionTarget] = useState<string | null>(null)

  // Phase 4 audit B2 fix — read ?section= deep-link query param so notification
  // taps land at the right sub-area instead of dumping the user at the top of
  // the Friends tab. Recognised values: "requests" (incoming reference
  // requests), "accepted" (newly-accepted reference), "references" (the
  // TrustedReferencesSection top). All three resolve to the trusted-references
  // wrapper today; the section is shown by TrustedReferencesSection itself,
  // which already orders pending requests above accepted ones, so a user
  // tapping a "your reference was accepted" notification lands above the
  // accepted carousel and the requested-area both.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const trustedReferencesRef = useRef<HTMLDivElement | null>(null)

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

  // Phase 4 audit B2 — when ?section= deep-links into the trust subarea,
  // scroll the references wrapper into view AFTER the connections fetch
  // has settled. The 'requests' / 'accepted' / 'references' values all
  // resolve to the same TrustedReferencesSection wrapper today; if we
  // later add per-subsection anchors we can branch by value here.
  useEffect(() => {
    if (loading) return
    const section = requestedSection
    const KNOWN = ['requests', 'accepted', 'references']
    if (section && KNOWN.includes(section) && trustedReferencesRef.current) {
      // requestAnimationFrame so we scroll AFTER the new layout is committed
      // (avoids a flicker where the page briefly shows the top before scrolling).
      const id = requestAnimationFrame(() => {
        trustedReferencesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      return () => cancelAnimationFrame(id)
    }
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
      } catch (error) {
        logger.error('Failed to update friendship', error)
        addToast('Unable to update friendship. Please try again.', 'error')
      } finally {
        setActionTarget(null)
      }
    },
    [addToast, fetchConnections]
  )

  const isActionLoading = (friendshipId: string | null) => actionTarget === friendshipId

  const getInitials = (name?: string | null) => {
    if (!name) return '?'
    return name
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase())
      .slice(0, 2)
      .join('')
  }

  const humanizeDate = (isoString?: string | null) => {
    if (!isoString) return 'just now'
    return formatDistanceToNow(new Date(isoString), { addSuffix: true })
  }

  const buildProfileLink = (friend: FriendProfile | null) => {
    if (!friend) return '#'
    const slug = friend.username ? `${friend.username}` : `id/${friend.id}`
    if (friend.role === 'club') return `/clubs/${slug}`
    if (friend.role === 'umpire') return `/umpires/${slug}`
    // Brands key on brand.slug (not profiles.username), so the username
    // path won't resolve. Always go through the id-redirect, which looks
    // up the canonical slug and redirects to /brands/:slug.
    if (friend.role === 'brand') return `/brands/id/${friend.id}`
    return `/players/${slug}`
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
          {connection.accepted_at && <span>Friends since {humanizeDate(connection.accepted_at)}</span>}
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
                  setAskVouchFor(connection.friend_id)
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
                onClick={() => void updateFriendship(connection.id, 'cancelled', 'Friend removed.')}
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
                onClick={() => void updateFriendship(connection.id, 'accepted', 'Friend request accepted.')}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isActionLoading(connection.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Accept
              </button>
              <button
                type="button"
                disabled={isActionLoading(connection.id)}
                onClick={() => void updateFriendship(connection.id, 'rejected', 'Friend request declined.')}
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
              onClick={() => void updateFriendship(connection.id, 'cancelled', 'Friend request cancelled.')}
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
      {canShowTrustedReferences && (
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
            <h2 className="text-2xl font-bold text-gray-900">Friends</h2>
            <p className="text-sm text-gray-600">Trusted connections build credibility on HOCKIA.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
            <Users className="h-4 w-4 text-[#8026FA]" />
            {acceptedConnections.length} {acceptedConnections.length === 1 ? 'friend' : 'friends'}
          </div>
        </div>
      </section>

      {isOwner && (
        <section className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Incoming Requests</h3>
            <p className="text-sm text-gray-500">Approve or decline pending requests from other members.</p>
          </div>
          {incomingRequests.length === 0
            ? renderEmptyState('No incoming requests', 'New friend requests will show up here.')
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
            <h3 className="text-lg font-semibold text-gray-900">Outgoing Requests</h3>
            <p className="text-sm text-gray-500">Track friend requests you&apos;ve sent.</p>
          </div>
          {outgoingRequests.length === 0
            ? renderEmptyState('No pending requests', 'You haven\'t sent any friend requests yet.')
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
              readOnly ? 'No friends listed yet' : 'No friends yet',
              readOnly
                ? 'This member hasn\'t added any friends yet.'
                : 'Build your network by connecting with players, coaches, and clubs.',
              readOnly
                ? undefined
                : (
                    <button
                      type="button"
                      onClick={() => addToast('Visit another profile to send a friend request.', 'info')}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <UserPlus className="h-4 w-4" />
                      Find friends
                    </button>
                  )
            )
          : (
            <div className="space-y-4">
              {acceptedConnections.map((connection) => renderFriendCard(connection, isOwner))}
            </div>
          )}
      </section>
    </div>
  )
}
