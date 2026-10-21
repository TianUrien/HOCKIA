import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { Header, NewMessageModal } from '@/components'
import { LargeTitleBar } from '@/components/ui/LargeTitleBar'
import { IconButton } from '@/components/ui/IconButton'
import { InboxMessages } from '@/components/inbox/InboxMessages'
import { InboxActivity } from '@/components/inbox/InboxActivity'
import { InboxRequestsSegment, InboxSegmentControl } from '@/components/inbox/InboxSegments'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { isInboxSegment, inboxSegmentPath, useRefreshInboxEdges, type InboxSegment } from '@/lib/inboxSegments'
import MessagesPage from '@/pages/MessagesPage'

/**
 * /inbox — the fourth tab (Figma 03 Player, 00 Architecture decision 2).
 * "Inbox is a tab, not two header icons": it holds the three things a member
 * waits on — messages, friend requests, activity. Club replies to
 * applications land in Messages, which is why the Pulse links here.
 *
 * Desktop (≥ 1024 px, design audit 2026-10-21 B4): one master-detail inbox,
 * the same component /messages renders (segments in the left column, the
 * thread on the right). Phones keep the tab below.
 */
export default function InboxPage() {
  const isPhone = useMediaQuery('(max-width: 1023px)')
  return isPhone ? <PhoneInbox /> : <MessagesPage />
}

function PhoneInbox() {
  useScrollRestore()
  useDocumentTitle('Inbox')
  const navigate = useNavigate()
  const { segment } = useParams<{ segment?: string }>()
  const active: InboxSegment = isInboxSegment(segment) ? segment : 'messages'
  const [composeOpen, setComposeOpen] = useState(false)
  useRefreshInboxEdges()

  const setSegment = (next: InboxSegment) => {
    navigate(inboxSegmentPath(next), { replace: true })
  }

  const newMessageButton = (
    <IconButton label="New message" onClick={() => setComposeOpen(true)}>
      <Pencil className="h-[22px] w-[22px]" strokeWidth={1.8} />
    </IconButton>
  )

  return (
    <div className="min-h-screen bg-white">
      <Header mobileHidden />
      <main className="mx-auto max-w-2xl pb-24 pt-[calc(env(safe-area-inset-top)+0.5rem)] lg:pt-24">
        <LargeTitleBar title="Inbox" trailing={newMessageButton} />

        <div className="px-5 pb-2 pt-0.5">
          <InboxSegmentControl value={active} onChange={setSegment} />
        </div>

        {active === 'messages' && <InboxMessages onCompose={() => setComposeOpen(true)} />}
        {active === 'requests' && <InboxRequestsSegment />}
        {active === 'activity' && <InboxActivity />}
      </main>

      <NewMessageModal isOpen={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  )
}
