import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, X } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ConversationSkeleton } from '@/components/Skeleton'
import { identityLine } from '@/lib/identity'
import { formatActivityAge } from '@/lib/inboxTime'
import { profilePath } from '@/lib/profileNavigation'
import type { FriendRequest, FriendRequestAction } from '@/hooks/useFriendRequests'

interface InboxRequestsProps {
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  loading: boolean
  pendingId: string | null
  respond: (friendshipId: string, action: FriendRequestAction) => Promise<boolean>
}

type Resolved = 'accepted' | 'declined'

/**
 * Inbox › Requests (Figma 100:406 / 115:1247). Received requests with a
 * purple Accept pill and a round Decline; after Accept the row becomes a
 * quiet confirmation instead of vanishing. Sent requests sit below as
 * "Waiting".
 */
export function InboxRequests({ incoming, outgoing, loading, pendingId, respond }: InboxRequestsProps) {
  // Rows the member has just acted on stay visible with their outcome until
  // the next visit (design note: "the row becomes a quiet confirmation").
  const [resolved, setResolved] = useState<Record<string, Resolved>>({})
  const [snapshot, setSnapshot] = useState<Record<string, FriendRequest>>({})

  const act = async (request: FriendRequest, action: Exclude<FriendRequestAction, 'cancel'>) => {
    setSnapshot((s) => ({ ...s, [request.friendshipId]: request }))
    const ok = await respond(request.friendshipId, action)
    if (ok) setResolved((r) => ({ ...r, [request.friendshipId]: action === 'accept' ? 'accepted' : 'declined' }))
    else setSnapshot((s) => { const next = { ...s }; delete next[request.friendshipId]; return next })
  }

  const liveIds = new Set(incoming.map((r) => r.friendshipId))
  const rows: FriendRequest[] = [
    ...incoming,
    ...Object.values(snapshot).filter((r) => !liveIds.has(r.friendshipId) && resolved[r.friendshipId]),
  ]

  if (loading) {
    return (
      <div>
        <ConversationSkeleton />
        <ConversationSkeleton />
      </div>
    )
  }

  return (
    <section aria-label="Friend requests">
      <p className="px-5 pb-2 text-secondary text-ink-2">Friends can message you, see your full media and write you a reference.</p>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-row text-ink-2">No requests right now.</p>
      ) : (
        <ul>
          {rows.map((request) => {
            const outcome = resolved[request.friendshipId]
            const busy = pendingId === request.friendshipId
            const person = request.person
            const name = person?.full_name ?? person?.username ?? 'HOCKIA member'
            const to = person ? profilePath(person.role, person.username, person.id) : null
            return (
              <li key={request.friendshipId} className="flex items-center gap-3 px-5 py-3">
                <RowLink to={to} className="flex min-w-0 flex-1 items-center gap-3">
                  <EntityAvatar src={person?.avatar_url} name={name} role={person?.role} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-row font-semibold text-ink-1">{name}</span>
                    <span className="block truncate text-secondary text-ink-2">{identityLine(person?.role, person?.position)}</span>
                    <span className="block text-secondary text-ink-4">
                      {outcome === 'accepted' ? 'Now friends' : outcome === 'declined' ? 'Declined' : `Requested · ${formatActivityAge(request.createdAt)}`}
                    </span>
                  </span>
                </RowLink>
                {outcome === 'accepted' ? (
                  <span className="flex h-[34px] items-center gap-1 rounded-full bg-positive-soft px-3 text-[14px] font-semibold text-positive">
                    <Check className="h-4 w-4" strokeWidth={2.5} /> Friends
                  </span>
                ) : outcome === 'declined' ? null : (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(request, 'accept')}
                      className="flex h-[34px] items-center rounded-full bg-hockia-primary px-3.5 text-[14px] font-semibold text-white disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Accept'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(request, 'decline')}
                      aria-label={`Decline ${name}`}
                      className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-grouped text-ink-1 disabled:opacity-60"
                    >
                      <X className="h-4 w-4" strokeWidth={2.25} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {outgoing.length > 0 && (
        <>
          <h2 className="px-5 pb-1 pt-4 text-title text-ink-1">Sent</h2>
          <ul>
            {outgoing.map((request) => {
              const person = request.person
              const name = person?.full_name ?? person?.username ?? 'HOCKIA member'
              const to = person ? profilePath(person.role, person.username, person.id) : null
              return (
                <li key={request.friendshipId} className="flex items-center gap-3 px-5 py-3">
                  <RowLink to={to} className="flex min-w-0 flex-1 items-center gap-3">
                    <EntityAvatar src={person?.avatar_url} name={name} role={person?.role} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-row font-semibold text-ink-1">{name}</span>
                      <span className="block truncate text-secondary text-ink-2">
                        {identityLine(person?.role, person?.position)} · sent {formatActivityAge(request.createdAt)}
                      </span>
                    </span>
                  </RowLink>
                  <span className="flex h-[30px] items-center gap-1 rounded-full bg-surface-grouped px-3 text-secondary font-semibold text-ink-2">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Requested
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

function RowLink({ to, className, children }: { to: string | null; className: string; children: React.ReactNode }) {
  if (!to) return <div className={className}>{children}</div>
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  )
}
