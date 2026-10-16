import type { ReactNode } from 'react'
import AssistantMessage from '@/components/discover/AssistantMessage'
import { UserBubble } from '@/components/discover/UserBubble'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'

interface DiscoverChatProps {
  messages: DiscoverChatMessage[]
  /** Hockia AI sheet (handoff 2026-10-16): the mascot avatar beside each answer, no bubble. */
  assistantAvatar?: ReactNode
}

/**
 * The conversation (Figma 44:321): the member's question as a solid
 * brand-primary bubble on the right (radius 16, small tail corner), every
 * answer left-aligned with no avatar. No gradients anywhere.
 */
export default function DiscoverChat({ messages, assistantAvatar }: DiscoverChatProps) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map(msg => {
        if (msg.role === 'user') return <UserBubble key={msg.id} text={msg.content} />
        if (!assistantAvatar) return <AssistantMessage key={msg.id} msg={msg} />
        return (
          <div key={msg.id} className="flex items-start gap-2.5">
            {assistantAvatar}
            <div className="min-w-0 flex-1 pt-1.5"><AssistantMessage msg={msg} /></div>
          </div>
        )
      })}
    </div>
  )
}
