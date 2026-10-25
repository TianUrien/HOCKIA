import type { ReactNode } from 'react'
import AssistantMessage from '@/components/discover/AssistantMessage'
import { UserBubble } from '@/components/discover/UserBubble'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'

interface DiscoverChatProps {
  messages: DiscoverChatMessage[]
  /** Hockia AI sheet (handoff 2026-10-16): the mascot avatar beside each answer, no bubble. */
  assistantAvatar?: ReactNode
  /** Rendered right under an answer (Hockia AI: a brand offer, never inside the answer). */
  afterAnswer?: (msg: DiscoverChatMessage) => ReactNode
}

/**
 * The conversation (Figma 44:321): the member's question as a solid
 * brand-primary bubble on the right (radius 16, small tail corner), every
 * answer left-aligned with no avatar. No gradients anywhere.
 */
export default function DiscoverChat({ messages, assistantAvatar, afterAnswer }: DiscoverChatProps) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map(msg => {
        if (msg.role === 'user') return <UserBubble key={msg.id} text={msg.content} />
        const after = afterAnswer?.(msg)
        if (!assistantAvatar) return <div key={msg.id}><AssistantMessage msg={msg} />{after}</div>
        // Answers with result cards keep the full width (the cards are dense):
        // the avatar sits on its own line above. Text answers keep it beside.
        const hasCards = (msg.results?.length ?? 0) > 0 || (msg.recommendations?.length ?? 0) > 0 || (msg.opportunities?.length ?? 0) > 0
        if (hasCards) {
          return (
            <div key={msg.id} className="flex flex-col gap-1.5" data-testid="ai-answer-cards">
              {assistantAvatar}
              <AssistantMessage msg={msg} />
              {after}
            </div>
          )
        }
        return (
          <div key={msg.id} className="flex items-start gap-2.5">
            {assistantAvatar}
            <div className="min-w-0 flex-1 pt-1.5"><AssistantMessage msg={msg} />{after}</div>
          </div>
        )
      })}
    </div>
  )
}
