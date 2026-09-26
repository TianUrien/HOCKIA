import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SquarePen } from 'lucide-react'
import { Header, NewMessageModal } from '@/components'
import { LargeTitleBar } from '@/components/ui/LargeTitleBar'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { InboxMessages } from '@/components/inbox/InboxMessages'
import { InboxRequests } from '@/components/inbox/InboxRequests'
import { InboxActivity } from '@/components/inbox/InboxActivity'
import { useFriendRequests } from '@/hooks/useFriendRequests'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { useInboxSegmentDots } from '@/hooks/useInboxSegmentDots'
import { loadFriendshipEdges } from '@/hooks/friendshipEdgeCache'
import { useAuthStore } from '@/lib/auth'

const SEGMENTS = ['messages', 'requests', 'activity'] as const
type Segment = (typeof SEGMENTS)[number]

const isSegment = (value: string | undefined): value is Segment =>
  Boolean(value) && (SEGMENTS as readonly string[]).includes(value as string)

/**
 * /inbox — the fourth tab (Figma 03 Player, 00 Architecture decision 2).
 * "Inbox is a tab, not two header icons": it holds the three things a member
 * waits on — messages, friend requests, activity. Club replies to
 * applications land in Messages, which is why the Pulse links here.
 */
export default function InboxPage() {
  useScrollRestore()
  useDocumentTitle('Inbox')
  const navigate = useNavigate()
  const { segment } = useParams<{ segment?: string }>()
  const active: Segment = isSegment(segment) ? segment : 'messages'
  const [composeOpen, setComposeOpen] = useState(false)
  const requests = useFriendRequests()
  // A red dot (never a number) on each segment holding something unread.
  const dots = useInboxSegmentDots()

  // Opening Inbox re-reads the shared friendship edges so the Requests dot
  // (and the tab-bar dot, which shares it) matches the list shown here.
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  useEffect(() => {
    if (viewerId) void loadFriendshipEdges(viewerId, true)
  }, [viewerId])

  const setSegment = (next: Segment) => {
    navigate(next === 'messages' ? '/inbox' : `/inbox/${next}`, { replace: true })
  }

  const newMessageButton = (
    <IconButton label="New message" onClick={() => setComposeOpen(true)}>
      <SquarePen className="h-6 w-6" strokeWidth={1.8} />
    </IconButton>
  )

  return (
    <div className="min-h-screen bg-white">
      <Header mobileHidden />
      <main className="mx-auto max-w-2xl pb-24 pt-[max(env(safe-area-inset-top),0.5rem)] lg:pt-24">
        <LargeTitleBar title="Inbox" trailing={newMessageButton} />
        <div className="hidden items-center justify-between px-5 pb-2 lg:flex">
          <h1 className="text-title text-ink-1">Inbox</h1>
          {newMessageButton}
        </div>

        <div className="px-5 pb-2 pt-0.5">
          <SegmentedControl<Segment>
            ariaLabel="Inbox sections"
            value={active}
            onChange={setSegment}
            options={[
              { value: 'messages', label: 'Messages', dot: dots.messages },
              { value: 'requests', label: 'Requests', dot: dots.requests },
              { value: 'activity', label: 'Activity', dot: dots.activity },
            ]}
          />
        </div>

        {active === 'messages' && <InboxMessages onCompose={() => setComposeOpen(true)} />}
        {active === 'requests' && (
          <InboxRequests
            incoming={requests.incoming}
            outgoing={requests.outgoing}
            loading={requests.loading}
            pendingId={requests.pendingId}
            respond={requests.respond}
          />
        )}
        {active === 'activity' && <InboxActivity />}
      </main>

      <NewMessageModal isOpen={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  )
}
