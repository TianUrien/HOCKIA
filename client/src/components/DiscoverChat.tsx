import { useState } from 'react'
import { Bot, AlertCircle, RotateCcw, ChevronDown } from 'lucide-react'
import DiscoverResultCard from '@/components/DiscoverResultCard'
import DiscoverFilterChips from '@/components/DiscoverFilterChips'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'

interface DiscoverChatProps {
  messages: DiscoverChatMessage[]
  onRetry?: (query: string) => void
}

/** Typing indicator — 3 bouncing dots */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  )
}

/** Collapsible result card list — shows first 3, expand for more */
function ResultList({ results }: { results: NonNullable<DiscoverChatMessage['results']> }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? results : results.slice(0, 3)
  const hiddenCount = results.length - 3

  return (
    <div className="mt-2 space-y-1.5">
      {visible.map(r => (
        <DiscoverResultCard key={r.id} result={r} />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 w-full justify-center py-2 text-xs font-medium text-[#8026FA] hover:text-[#924CEC] transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Show all {results.length} results
        </button>
      )}
    </div>
  )
}

export default function DiscoverChat({ messages, onRetry }: DiscoverChatProps) {
  return (
    <div className="space-y-4">
      {messages.map(msg => {
        if (msg.role === 'user') {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] sm:max-w-[75%] px-4 py-2.5 bg-gradient-to-br from-[#8026FA] to-[#924CEC] text-white rounded-2xl rounded-tr-md shadow-sm">
                <p className="text-sm leading-relaxed">{msg.content}</p>
              </div>
            </div>
          )
        }

        // Assistant message
        return (
          <div key={msg.id} className="flex items-start gap-2.5">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#8026FA] to-[#924CEC] flex items-center justify-center mt-0.5">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0 max-w-[85%] sm:max-w-[75%]">
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
                {msg.status === 'sending' && <TypingIndicator />}

                {msg.status === 'error' && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-600 flex-1">{msg.content}</p>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={() => {
                          const idx = messages.findIndex(m => m.id === msg.id)
                          const prevUser = messages.slice(0, idx).reverse().find(m => m.role === 'user')
                          if (prevUser) onRetry(prevUser.content)
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#8026FA] hover:bg-[#8026FA]/5 rounded-lg transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Retry
                      </button>
                    )}
                  </div>
                )}

                {msg.status === 'complete' && (
                  <>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{msg.content}</p>
                    {msg.results && msg.results.length > 0 && (
                      <ResultList results={msg.results} />
                    )}
                  </>
                )}
              </div>

              {/* Filter chips below the bubble */}
              {msg.status === 'complete' && msg.parsed_filters && (
                <div className="mt-1.5 pl-1">
                  <DiscoverFilterChips filters={msg.parsed_filters} />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
