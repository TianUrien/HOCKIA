import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Send, Loader2, RotateCcw, ChevronLeft } from 'lucide-react'
import { useDiscoverChat } from '@/hooks/useDiscover'
import DiscoverChat from '@/components/DiscoverChat'
import { useAuthStore } from '@/lib/auth'

/** Default examples for unauthenticated visits + the universal fallback set.
 *  Every role-specific example list also keeps a search prompt so the user
 *  immediately sees what the AI can do beyond self-reflection. */
const DEFAULT_EXAMPLES = [
  'Find U25 defenders with a EU passport and 2+ references',
  'Show female defenders open to play',
  'Find men goalkeepers from New Zealand',
]

/** Role-aware first-impression prompts. Each role gets a mix of:
 *  - one self-reflection prompt ("what should I improve")
 *  - one search prompt seeded by their context
 *  - one connection / next-action prompt
 *  This is the entry-point onto Phase 1 personalisation. */
const ROLE_EXAMPLES: Record<string, string[]> = {
  player: [
    'What should I improve in my profile?',
    'What clubs would suit me?',
    'Who should I connect with?',
  ],
  coach: [
    'What should I add to my profile?',
    'Show me clubs hiring head coaches',
    'Players I could recommend for my staff',
  ],
  club: [
    'What can I do next on HOCKIA?',
    'Show me available defenders for my team',
    'Show me coaches with head-coach experience',
  ],
  brand: [
    'What\'s missing from my brand profile?',
    'Players who could be ambassadors',
    'How do I get more visibility on the Marketplace?',
  ],
  umpire: [
    'What should I improve in my profile?',
    'Show me umpires from my country',
    'How can I get more visibility?',
  ],
}

function getFirstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null
  const trimmed = fullName.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0]
}

export default function DiscoverPage() {
  const navigate = useNavigate()
  const { messages, sendMessage, clearChat, isPending } = useDiscoverChat()
  const profile = useAuthStore(s => s.profile)
  const [input, setInput] = useState('')
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const hasMessages = messages.length > 0

  // Greeting + example set are derived from the auth-store profile. When the
  // profile hasn't loaded yet we fall back to the generic example set so the
  // empty state never blocks on a network round-trip; once the profile
  // arrives the examples swap to the role-aware variant.
  const firstName = getFirstName(profile?.full_name ?? null)
  const exampleQueries = useMemo(
    () => (profile?.role && ROLE_EXAMPLES[profile.role]) || DEFAULT_EXAMPLES,
    [profile?.role]
  )

  // Track visual viewport for mobile keyboard awareness.
  // On iOS Safari, the keyboard changes visualViewport.height and may scroll
  // the viewport (offsetTop). We listen to BOTH resize and scroll events and
  // directly set the container's height + top so it always fills exactly the
  // visible area above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport
    const el = containerRef.current
    if (!vv || !el) return

    const sync = () => {
      el.style.height = `${vv.height}px`
      el.style.top = `${vv.offsetTop}px`
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  // Rotate placeholder text
  useEffect(() => {
    if (hasMessages) return
    const interval = setInterval(() => {
      setPlaceholderIndex(i => (i + 1) % exampleQueries.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [hasMessages, exampleQueries.length])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(120, Math.max(44, ta.scrollHeight))}px`
  }, [])

  useEffect(() => {
    resizeTextarea()
  }, [input, resizeTextarea])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isPending) return
    sendMessage(trimmed)
    setInput('')
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = '44px'
      }
    })
  }, [input, isPending, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleExampleClick = (example: string) => {
    sendMessage(example)
  }

  const handleRetry = useCallback((query: string) => {
    sendMessage(query)
  }, [sendMessage])

  const handleFocus = useCallback(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 300)
  }, [])

  return (
    <div
      ref={containerRef}
      className="fixed inset-x-0 top-0 flex flex-col bg-gray-50"
      style={{ height: '100dvh' }}
    >
      {/* ── Chat header ──────────────────────────────────────────── */}
      <header className="flex items-center gap-3 h-14 px-3 border-b border-gray-200 bg-white flex-shrink-0 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors -ml-1"
        >
          <ChevronLeft className="w-5 h-5 text-gray-700" />
        </button>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#8026FA] to-[#924CEC] flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[15px] font-semibold text-gray-900 leading-tight">Discover</h1>
          <p className="text-[11px] text-gray-500 leading-tight">AI-powered search</p>
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={clearChat}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-[#8026FA] hover:bg-[#8026FA]/5 rounded-full transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            New
          </button>
        )}
      </header>

      {/* ── Scrollable chat area ─────────────────────────────────── */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto px-4 py-4">
          {!hasMessages ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8026FA] to-[#924CEC] flex items-center justify-center mb-4 shadow-lg shadow-[#8026FA]/20">
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {firstName ? `Hi ${firstName}!` : 'Discover'}
              </h2>
              <p className="text-sm text-gray-500 text-center mb-8 max-w-xs">
                {firstName
                  ? 'What can I help you with today? I know your HOCKIA profile, so I can give answers tailored to you.'
                  : 'Ask me anything — search for players, coaches, clubs, and brands using natural language.'}
              </p>
              <div className="w-full max-w-sm space-y-2">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide text-center mb-2">
                  Try asking
                </p>
                {exampleQueries.map(example => (
                  <button
                    type="button"
                    key={example}
                    onClick={() => handleExampleClick(example)}
                    className="w-full text-left p-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-[#8026FA] hover:bg-[#8026FA]/5 transition-colors"
                  >
                    <span className="text-gray-400 mr-1">&ldquo;</span>
                    {example}
                    <span className="text-gray-400 ml-1">&rdquo;</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <DiscoverChat messages={messages} onRetry={handleRetry} />
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Composer (fixed bottom) ──────────────────────────────── */}
      <div className="border-t border-gray-200 bg-white flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="relative flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => {
                if (e.target.value.length <= 500) setInput(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              placeholder={hasMessages ? 'Follow up or ask something new…' : exampleQueries[placeholderIndex]}
              rows={1}
              disabled={isPending}
              className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 pr-12 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA]/50 focus:bg-white transition-all disabled:opacity-60 min-h-[44px] max-h-[120px]"
              enterKeyHint="send"
              autoCapitalize="sentences"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isPending || input.trim().length < 1}
              className="absolute right-2 bottom-1.5 w-9 h-9 flex items-center justify-center rounded-full bg-gradient-to-br from-[#8026FA] to-[#924CEC] text-white shadow-sm disabled:opacity-40 disabled:shadow-none hover:shadow-md transition-all"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
