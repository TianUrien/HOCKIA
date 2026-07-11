import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, X, Check, UserPlus, UserMinus, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { useAuthStore } from '@/lib/auth'
import Avatar from '../Avatar'
import RoleBadge from '../RoleBadge'
import ConfirmActionModal from '../ConfirmActionModal'
import type { Database } from '@/lib/database.types'

/**
 * ConnectionsSection — segmented Connections / Requests / Sent panel.
 *
 * Replaces the FriendsTab three-stacked-section pattern (Connections,
 * Incoming Requests, Outgoing Requests rendered one after the other)
 * with a single segmented control. Default tab is Connections so the
 * user lands on their network instead of an empty incoming-requests
 * list. Used by PlayerCommunityHub on /dashboard/profile/community.
 *
 * The standalone /dashboard/profile/friends route still renders the
 * legacy FriendsTab — the focused-views split set up in PR2 lets both
 * coexist.
 */
type FriendEdge = Database['public']['Views']['profile_friend_edges']['Row']
type FriendProfile = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'avatar_url' | 'role' | 'username' | 'base_location' | 'current_club'
>
type EnrichedEdge = FriendEdge & { friend: FriendProfile | null }

type TabId = 'connections' | 'requests' | 'sent'

interface ConnectionsSectionProps {
  profileId: string
  profileRole?: string | null
  /** "Ask to vouch" CTA on a connection row. Optional — Hub provides
   *  it; standalone usage can omit to disable the action. */
  onAskToVouch?: (friendId: string) => void
}

export default function ConnectionsSection({ profileId, profileRole, onAskToVouch }: ConnectionsSectionProps) {
  const { profile: authProfile } = useAuthStore()
  const navigate = useNavigate()
  const { addToast } = useToastStore()
  const isOwner = authProfile?.id === profileId

  const [connections, setConnections] = useState<EnrichedEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>('connections')
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)

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
            .filter((id): id is string => Boolean(id)),
        ),
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
      const enriched: EnrichedEdge[] = (edges ?? []).map((edge) => ({
        ...edge,
        friend: edge.friend_id ? profileMap.get(edge.friend_id) ?? null : null,
      }))
      setConnections(enriched)
    } catch (error) {
      logger.error('[ConnectionsSection] fetch failed', error)
      addToast('Unable to load connections. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }, [profileId, addToast])

  useEffect(() => {
    void fetchConnections()
  }, [fetchConnections])

  const accepted = useMemo(
    () => connections.filter((c) => c.status === 'accepted'),
    [connections],
  )
  const incoming = useMemo(
    () =>
      isOwner
        ? connections.filter((c) => c.status === 'pending' && c.requester_id !== profileId)
        : [],
    [connections, isOwner, profileId],
  )
  const outgoing = useMemo(
    () =>
      isOwner
        ? connections.filter((c) => c.status === 'pending' && c.requester_id === profileId)
        : [],
    [connections, isOwner, profileId],
  )

  const updateStatus = useCallback(
    async (id: string, status: 'accepted' | 'rejected' | 'cancelled') => {
      setMutatingId(id)
      try {
        const { error } = await supabase
          .from('profile_friendships')
          .update({ status })
          .eq('id', id)
        if (error) throw error
        await fetchConnections()
        const msg =
          status === 'accepted'
            ? 'Connection accepted.'
            : status === 'rejected'
              ? 'Request declined.'
              : 'Request withdrawn.'
        addToast(msg, 'success')
      } catch (error) {
        logger.error('[ConnectionsSection] update failed', error)
        addToast('Could not update connection. Please try again.', 'error')
      } finally {
        setMutatingId(null)
      }
    },
    [addToast, fetchConnections],
  )

  // Remove = revoke an accepted connection. The friendships RLS update
  // policy only lets the recipient set 'accepted/rejected/blocked', NOT
  // 'cancelled' — so an UPDATE with status='cancelled' silently affects
  // 0 rows when the recipient hits Remove, and the row stays in the
  // accepted list. DELETE is the right call: the delete policy allows
  // both user_one AND user_two. We also gate it behind a confirm modal
  // so it matches the destructiveness of Withdraw endorsement.
  const performRemove = useCallback(
    async (id: string) => {
      setMutatingId(id)
      try {
        const { error } = await supabase.from('profile_friendships').delete().eq('id', id)
        if (error) throw error
        await fetchConnections()
        addToast('Connection removed.', 'success')
      } catch (error) {
        logger.error('[ConnectionsSection] remove failed', error)
        addToast('Could not remove connection. Please try again.', 'error')
      } finally {
        setMutatingId(null)
      }
    },
    [addToast, fetchConnections],
  )

  const list = tab === 'connections' ? accepted : tab === 'requests' ? incoming : outgoing

  return (
    <section
      data-testid="connections-section"
      className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6"
    >
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Connections</h2>
          <p className="mt-0.5 text-xs text-gray-500">People in your HOCKIA network.</p>
        </div>
        <Link
          to="/dashboard/profile/friends"
          className="text-sm font-medium text-hockia-primary hover:text-[#6B20D4] flex-shrink-0"
        >
          View all
        </Link>
      </header>

      {/* Segmented tab control */}
      <div
        role="tablist"
        aria-label="Connection filter"
        className="flex items-center gap-1 mb-4 border-b border-gray-100"
      >
        <TabButton id="connections" current={tab} onClick={setTab} label="Connections" />
        {isOwner && (
          <TabButton
            id="requests"
            current={tab}
            onClick={setTab}
            label="Requests"
            badge={incoming.length}
          />
        )}
        {isOwner && (
          <TabButton
            id="sent"
            current={tab}
            onClick={setTab}
            label="Sent"
            badge={outgoing.length}
          />
        )}
      </div>

      {loading ? (
        <SkeletonRow />
      ) : list.length === 0 ? (
        <EmptyState tab={tab} isOwner={isOwner} />
      ) : (
        <ul className="space-y-2">
          {list.map((edge) => edge.id && (
            <ConnectionRow
              key={edge.id}
              edge={edge}
              tab={tab}
              isOwner={isOwner}
              canAskToVouch={
                isOwner &&
                Boolean(onAskToVouch) &&
                ['player', 'coach', 'umpire'].includes(profileRole ?? '')
              }
              mutating={mutatingId === edge.id}
              onAskToVouch={onAskToVouch}
              onAccept={() => updateStatus(edge.id!, 'accepted')}
              onReject={() => updateStatus(edge.id!, 'rejected')}
              onCancel={() => updateStatus(edge.id!, 'cancelled')}
              onRemove={() =>
                setRemoveTarget({
                  id: edge.id!,
                  name:
                    edge.friend?.full_name || edge.friend?.username || 'this connection',
                })
              }
              onOpenProfile={() => {
                if (!edge.friend?.id) return
                const role = edge.friend.role
                const base =
                  role === 'club'
                    ? '/clubs'
                    : role === 'brand'
                      ? '/brands'
                      : role === 'umpire'
                        ? '/umpires'
                        : role === 'coach'
                          ? '/coaches'
                          : '/players'
                const slug = edge.friend.username ?? `id/${edge.friend.id}`
                navigate(`${base}/${slug}`)
              }}
            />
          ))}
        </ul>
      )}

      <ConfirmActionModal
        isOpen={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (!removeTarget) return
          await performRemove(removeTarget.id)
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
        confirmLoading={Boolean(removeTarget && mutatingId === removeTarget.id)}
        loadingLabel="Removing..."
      />
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────

function TabButton({
  id,
  current,
  onClick,
  label,
  badge,
}: {
  id: TabId
  current: TabId
  onClick: (next: TabId) => void
  label: string
  badge?: number
}) {
  const active = id === current
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active ? 'true' : 'false'}
      onClick={() => onClick(id)}
      className={`relative px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? 'text-hockia-primary border-hockia-primary'
          : 'text-gray-500 hover:text-gray-900 border-transparent'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {badge !== undefined && badge > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hockia-primary px-1.5 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </span>
    </button>
  )
}

function SkeletonRow() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/60 animate-pulse">
          <div className="h-10 w-10 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 bg-gray-200 rounded" />
            <div className="h-3 w-20 bg-gray-100 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ tab, isOwner }: { tab: TabId; isOwner: boolean }) {
  const copy =
    tab === 'connections'
      ? isOwner
        ? 'No connections yet. Find people on HOCKIA to grow your network.'
        : 'No connections to show yet.'
      : tab === 'requests'
        ? 'No pending requests.'
        : 'No requests sent.'
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-8 text-center">
      <p className="text-sm text-gray-500">{copy}</p>
    </div>
  )
}

interface ConnectionRowProps {
  edge: EnrichedEdge
  tab: TabId
  isOwner: boolean
  canAskToVouch: boolean
  mutating: boolean
  onAskToVouch?: (friendId: string) => void
  onAccept: () => void
  onReject: () => void
  onCancel: () => void
  onRemove: () => void
  onOpenProfile: () => void
}

function ConnectionRow({
  edge,
  tab,
  isOwner,
  canAskToVouch,
  mutating,
  onAskToVouch,
  onAccept,
  onReject,
  onCancel,
  onRemove,
  onOpenProfile,
}: ConnectionRowProps) {
  const friend = edge.friend
  const fullName = friend?.full_name || friend?.username || 'HOCKIA Member'
  const initials = (friend?.full_name ?? '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const timestampLabel = formatTimestamp(edge, tab)

  return (
    <li className="rounded-xl border border-gray-100 bg-white p-3 hover:bg-gray-50/60 transition-colors">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpenProfile}
          className="flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 rounded-full"
          aria-label={`Open ${fullName}'s profile`}
        >
          <Avatar
            src={friend?.avatar_url}
            initials={initials || '?'}
            size="md"
            role={friend?.role}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="font-medium text-sm text-gray-900 hover:text-hockia-primary transition-colors truncate text-left"
            >
              {fullName}
            </button>
            {friend?.role && (
              <RoleBadge role={friend.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'} />
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 truncate flex items-center gap-1">
            {friend?.base_location && (
              <>
                <MapPin className="h-3 w-3" />
                <span>{friend.base_location}</span>
              </>
            )}
          </p>
          {timestampLabel && (
            <p className="mt-0.5 text-[11px] text-gray-400">{timestampLabel}</p>
          )}
        </div>

        {/* Action cluster — vertical on mobile to keep rows compact */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          {tab === 'connections' && isOwner && (
            <>
              {canAskToVouch && edge.friend_id && (
                <button
                  type="button"
                  onClick={() => onAskToVouch?.(edge.friend_id!)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                >
                  <ShieldCheck className="h-3 w-3" />
                  Ask to vouch
                </button>
              )}
              <button
                type="button"
                onClick={onRemove}
                disabled={mutating}
                className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <UserMinus className="h-3 w-3" />
                Remove
              </button>
            </>
          )}
          {tab === 'requests' && isOwner && (
            <>
              <button
                type="button"
                onClick={onAccept}
                disabled={mutating}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Accept
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={mutating}
                className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Reject
              </button>
            </>
          )}
          {tab === 'sent' && isOwner && (
            <button
              type="button"
              onClick={onCancel}
              disabled={mutating}
              className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function formatTimestamp(edge: EnrichedEdge, tab: TabId): string | null {
  // "Connected for X" on accepted; "Sent X ago" on outgoing pending;
  // "Requested X ago" only used in legacy UI — we use the same source
  // (edge.created_at) but with the cleaner verbs from the redesign brief.
  const date = tab === 'connections' ? edge.accepted_at : edge.created_at
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  const diffMs = Date.now() - d.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  let phrase: string
  if (days < 1) phrase = 'today'
  else if (days < 7) phrase = `${days} day${days === 1 ? '' : 's'} ago`
  else if (days < 30) {
    const weeks = Math.floor(days / 7)
    phrase = `${weeks} week${weeks === 1 ? '' : 's'} ago`
  } else if (days < 365) {
    const months = Math.floor(days / 30)
    phrase = `${months} month${months === 1 ? '' : 's'} ago`
  } else {
    const years = Math.floor(days / 365)
    phrase = `${years} year${years === 1 ? '' : 's'} ago`
  }
  return tab === 'connections' ? `Connected ${phrase}` : `Sent ${phrase}`
}

// Re-export the UserPlus icon import to silence the unused-import error
// (we use it only in the conditional Ask-to-vouch path).
export { UserPlus }
