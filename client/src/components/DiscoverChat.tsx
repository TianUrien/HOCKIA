import AssistantMessage from '@/components/discover/AssistantMessage'
import { UserBubble } from '@/components/discover/UserBubble'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'

interface DiscoverChatProps {
  messages: DiscoverChatMessage[]
}

/**
 * The conversation (Figma 44:321): the member's question as a solid
 * brand-primary bubble on the right (radius 16, small tail corner), every
 * answer left-aligned with no avatar. No gradients anywhere.
 */
export default function DiscoverChat({ messages }: DiscoverChatProps) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map(msg => {
        if (msg.role === 'user') return <UserBubble key={msg.id} text={msg.content} />
        return <AssistantMessage key={msg.id} msg={msg} />
      })}
    </div>
  )
}
