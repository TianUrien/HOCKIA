import AssistantMessage from '@/components/discover/AssistantMessage'
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
        if (msg.role === 'user') {
          return (
            <div key={msg.id} className="flex justify-end">
              <div
                className="max-w-[85%] rounded-[16px] rounded-br-[4px] bg-hockia-primary px-4 py-2.5 text-white"
                data-testid="ai-user-bubble"
              >
                <p className="text-row whitespace-pre-line">{msg.content}</p>
              </div>
            </div>
          )
        }
        return <AssistantMessage key={msg.id} msg={msg} />
      })}
    </div>
  )
}
