import AssistantMessage from '@/components/discover/AssistantMessage'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'

interface DiscoverChatProps {
  messages: DiscoverChatMessage[]
}

export default function DiscoverChat({ messages }: DiscoverChatProps) {
  return (
    <div className="space-y-4">
      {messages.map(msg => {
        if (msg.role === 'user') {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] sm:max-w-[75%] px-4 py-2.5 bg-gradient-to-br from-hockia-primary to-hockia-secondary text-white rounded-2xl rounded-tr-md shadow-sm">
                <p className="text-sm leading-relaxed">{msg.content}</p>
              </div>
            </div>
          )
        }
        return <AssistantMessage key={msg.id} msg={msg} />
      })}
    </div>
  )
}
