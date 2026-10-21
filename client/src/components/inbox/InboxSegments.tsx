import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { InboxRequests } from '@/components/inbox/InboxRequests'
import { useFriendRequests } from '@/hooks/useFriendRequests'
import { useMyClubInvitations } from '@/hooks/useClubInvitations'
import { useRespondToClubInvite } from '@/hooks/useRespondToClubInvite'
import { useInboxSegmentDots } from '@/hooks/useInboxSegmentDots'
import { useMarkInboxRequestsSeen } from '@/hooks/useMarkInboxRequestsSeen'
import type { InboxSegment } from '@/lib/inboxSegments'

/** Messages · Requests · Activity with a red dot (never a number) on what's new. */
export function InboxSegmentControl({ value, onChange }: { value: InboxSegment; onChange: (next: InboxSegment) => void }) {
  const dots = useInboxSegmentDots()
  return (
    <SegmentedControl<InboxSegment>
      ariaLabel="Inbox sections"
      value={value}
      onChange={onChange}
      options={[
        { value: 'messages', label: 'Messages', dot: dots.messages },
        { value: 'requests', label: 'Requests', dot: dots.requests },
        { value: 'activity', label: 'Activity', dot: dots.activity },
      ]}
    />
  )
}

/**
 * Inbox › Requests with its data. Opening the segment marks the shown requests
 * seen (they stay pending), which clears the segment dot (founder spec
 * 2026-10-09).
 */
export function InboxRequestsSegment() {
  const requests = useFriendRequests()
  const { invitations: clubInvitations } = useMyClubInvitations()
  const clubInvite = useRespondToClubInvite()
  useMarkInboxRequestsSeen(
    !requests.loading,
    requests.incoming.map((r) => r.friendshipId),
    clubInvitations.map((i) => i.clubMemberId),
  )
  return (
    <InboxRequests
      incoming={requests.incoming}
      outgoing={requests.outgoing}
      loading={requests.loading}
      pendingId={requests.pendingId}
      respond={requests.respond}
      clubInvitations={clubInvitations}
      clubInvitePendingId={clubInvite.pendingId}
      respondToClubInvite={clubInvite.respond}
    />
  )
}
