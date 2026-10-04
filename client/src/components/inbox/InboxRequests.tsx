import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, X } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ConversationSkeleton } from '@/components/Skeleton'
import { IconButton } from '@/components/ui/IconButton'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { identityLine, isOrganisationRole } from '@/lib/identity'
import { useFriendsInCommon } from '@/hooks/useFriendsInCommon'
import { formatActivityAge } from '@/lib/inboxTime'
import { profilePath } from '@/lib/profileNavigation'
import type { FriendRequest, FriendRequestAction } from '@/hooks/useFriendRequests'
import type { MyClubInvitation } from '@/lib/clubInvitations'

interface InboxRequestsProps {
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  loading: boolean
  pendingId: string | null
  respond: (friendshipId: string, action: FriendRequestAction) => Promise<boolean>
  /** Pending squad invitations addressed to the viewer (always listed first). */
  clubInvitations?: MyClubInvitation[]
  clubInvitePendingId?: string | null
  respondToClubInvite?: (clubMemberId: string, action: 'accept' | 'decline') => Promise<boolean>
}

type Resolved = 'accepted' | 'declined'

/**
 * Inbox › Requests (Figma 100:406 / 115:1247). Rows are List item / Request
 * (548:550) in three states:
 *   Incoming — avatar 52, name, "role · position", "N mutual friends",
 *              Tonal Small "Accept" + Muted ✕ (a repeated row action is never the Primary).
 *   Accepted — green check "Friends" and "You can now message and reference
 *              each other". No modal, no toast: the row is the confirmation.
 *   Sent     — grey "Waiting".
 */
export function InboxRequests({
  incoming,
  outgoing,
  loading,
  pendingId,
  respond,
  clubInvitations = [],
  clubInvitePendingId = null,
  respondToClubInvite,
}: InboxRequestsProps) {
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
    <section aria-label="Requests">
      <p className="px-5 pb-1 pt-1 text-secondary text-ink-2" data-testid="requests-explainer">
        Friends can message you, see your full media and write you a reference.
      </p>

      {/* Squad invitations sit at the top while pending, read or not (Figma D1
          DEV NOTE: the invitee accepts in Inbox › Requests). Accept or Decline
          removes the row; the toast confirms. */}
      {clubInvitations.length > 0 && respondToClubInvite && (
        <ul aria-label="Club invitations" data-testid="inbox-club-invitations">
          {clubInvitations.map((invite) => (
            <ClubInvitationRow
              key={invite.clubMemberId}
              invite={invite}
              busy={clubInvitePendingId === invite.clubMemberId}
              respond={respondToClubInvite}
            />
          ))}
        </ul>
      )}

      {rows.length === 0 ? (
        clubInvitations.length > 0 ? null : <p className="px-5 py-8 text-center text-row text-ink-2">No requests right now.</p>
      ) : (
        <ul>
          {rows.map((request) => {
            const outcome = resolved[request.friendshipId]
            const busy = pendingId === request.friendshipId
            const person = request.person
            const name = person?.full_name ?? person?.username ?? 'HOCKIA member'
            const to = person ? profilePath(person.role, person.username, person.id) : null
            const state = outcome === 'accepted' ? 'accepted' : outcome === 'declined' ? 'declined' : 'incoming'
            return (
              <RequestRow
                key={request.friendshipId}
                state={state}
                to={to}
                avatar={<EntityAvatar src={person?.avatar_url} name={name} role={person?.role} size={52} />}
                name={name}
                meta={identityLine(person?.role, person?.position)}
                detail={
                  state === 'accepted' ? 'You can now message and reference each other'
                    : state === 'declined' ? 'Declined'
                      : <MutualFriendsLine memberId={person?.id ?? null} role={person?.role ?? null} />
                }
                trailing={
                  state === 'accepted' ? (
                    <span className="flex shrink-0 items-center gap-1 text-row font-semibold text-positive" data-testid="request-friends">
                      <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" /> Friends
                    </span>
                  ) : state === 'declined' ? null : (
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(request, 'accept')}
                        className={buttonClassName({ variant: 'tonal', size: 'small', radius: 'rounded-full' })}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Accepting" /> : 'Accept'}
                      </button>
                      <IconButton variant="muted" label={`Decline ${name}`} disabled={busy} onClick={() => void act(request, 'decline')}>
                        <X className="h-[18px] w-[18px]" strokeWidth={2} />
                      </IconButton>
                    </span>
                  )
                }
              />
            )
          })}
        </ul>
      )}

      {outgoing.length > 0 && (
        <>
          <h2 className="px-5 pb-1 pt-5 text-title text-ink-1">Sent</h2>
          <ul>
            {outgoing.map((request) => {
              const person = request.person
              const name = person?.full_name ?? person?.username ?? 'HOCKIA member'
              const to = person ? profilePath(person.role, person.username, person.id) : null
              return (
                <RequestRow
                  key={request.friendshipId}
                  state="sent"
                  to={to}
                  avatar={<EntityAvatar src={person?.avatar_url} name={name} role={person?.role} size={52} />}
                  name={name}
                  meta={`${identityLine(person?.role, person?.position)} · sent ${formatActivityAge(request.createdAt)}`}
                  trailing={<span className="shrink-0 text-secondary text-ink-3" data-testid="request-waiting">Waiting</span>}
                />
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

type RequestRowState = 'incoming' | 'accepted' | 'declined' | 'sent'

/**
 * List item / Request (Figma 548:550). The avatar and text open the profile;
 * the trailing column holds the state (actions, "Friends", "Waiting"). The
 * divider starts at the text.
 */
function RequestRow({ state, to, avatar, name, meta, detail, trailing, testId = 'request-row' }: {
  state: RequestRowState
  to: string | null
  avatar: React.ReactNode
  name: string
  meta: React.ReactNode
  detail?: React.ReactNode
  trailing?: React.ReactNode
  testId?: string
}) {
  return (
    <li className="group flex items-center gap-3 pl-4" data-testid={testId} data-state={state}>
      <RowLink to={to} className="shrink-0" ariaHidden>{avatar}</RowLink>
      <div className="flex min-w-0 flex-1 items-center gap-3 border-b border-line py-3 pr-4 group-last:border-b-0">
        <RowLink to={to} className="block min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{name}</span>
          <span className="block truncate text-secondary text-ink-2">{meta}</span>
          {detail ? <span className="block truncate text-secondary text-ink-3" data-testid="request-detail">{detail}</span> : null}
        </RowLink>
        {trailing}
      </div>
    </li>
  )
}

/**
 * "2 mutual friends" on an incoming request: the real intersection of the
 * viewer's friends and the requester's (hooks/useFriendsInCommon — fenced
 * reads, cached per pair). People only, like the member preview; nothing
 * shows until the answer is in.
 */
function MutualFriendsLine({ memberId, role }: { memberId: string | null; role: string | null }) {
  const person = Boolean(memberId) && !isOrganisationRole(role)
  const { count, loading } = useFriendsInCommon(person ? memberId : null)
  if (!person || loading) return null
  return <>{count === 0 ? 'No mutual friends yet' : count === 1 ? '1 mutual friend' : `${count} mutual friends`}</>
}

function ClubInvitationRow({ invite, busy, respond }: {
  invite: MyClubInvitation
  busy: boolean
  respond: (clubMemberId: string, action: 'accept' | 'decline') => Promise<boolean>
}) {
  const name = invite.club.fullName ?? invite.club.username ?? 'A club'
  const to = profilePath('club', invite.club.username, invite.club.id)
  return (
    <RequestRow
      state="incoming"
      testId="inbox-club-invitation"
      to={to}
      avatar={<EntityAvatar src={invite.club.avatarUrl} name={name} role="club" size={52} />}
      name={name}
      meta="Invited you to join their club"
      detail={`Club invitation · ${formatActivityAge(invite.createdAt)}`}
      trailing={
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void respond(invite.clubMemberId, 'accept')}
            className={buttonClassName({ variant: 'tonal', size: 'small', radius: 'rounded-full' })}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Accepting" /> : 'Accept'}
          </button>
          <IconButton variant="muted" label={`Decline ${name}'s invitation`} disabled={busy} onClick={() => void respond(invite.clubMemberId, 'decline')}>
            <X className="h-[18px] w-[18px]" strokeWidth={2} />
          </IconButton>
        </span>
      }
    />
  )
}

function RowLink({ to, className, children, ariaHidden = false }: { to: string | null; className: string; children: React.ReactNode; ariaHidden?: boolean }) {
  if (!to) return <div className={className}>{children}</div>
  return (
    <Link to={to} className={className} aria-hidden={ariaHidden || undefined} tabIndex={ariaHidden ? -1 : undefined}>
      {children}
    </Link>
  )
}
