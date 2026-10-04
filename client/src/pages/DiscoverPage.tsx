import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUp, Flag, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { useDiscoverChat } from '@/hooks/useDiscover'
import DiscoverChat from '@/components/DiscoverChat'
import { SearchingIndicator } from '@/components/discover/AssistantMessage'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { IconButton } from '@/components/ui/IconButton'
import { useAuthStore } from '@/lib/auth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { greetingName } from '@/lib/profile'
import {
  BETA_NOTE,
  COMPOSER_MAX_LENGTH,
  COMPOSER_PLACEHOLDER,
  HOCKIA_AI_TITLE,
  TRY_ASKING_EYEBROW,
  exampleQueriesFor,
} from '@/lib/hockiaAi'

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'))

/**
 * Hockia AI (Figma "New-Hockia" 04 · Player — Live 44:321; states 524:1494
 * first use, 524:1575 loading, 524:1644 no match, 524:1715 can't answer,
 * 524:1785 error). Route stays /discover; phone-first, desktop keeps working
 * with the same column centred (max-w-md).
 *
 * Header: centred title, back chevron, More (…) → bottom sheet with
 * "Clear conversation" and "Report a problem" (existing feedback modal).
 * The sparkle appears only in the first-use mark. No gradients anywhere.
 * The composer has no attach button; purple round send, 44 pt targets.
 */
export default function DiscoverPage() {
  useDocumentTitle(HOCKIA_AI_TITLE)
  const [searchParams, setSearchParams] = useSearchParams()
  const { messages, sendMessage, clearChat, isPending } = useDiscoverChat()
  const profile = useAuthStore(s => s.profile)
  const [input, setInput] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Consume the ?q= seed once (Search v2 "Ask Hockia AI about …" prefills
  // it). Without the ref guard, Strict-Mode double-mount in dev would send
  // the seeded query twice; once consumed the param is stripped so refresh /
  // back-nav doesn't re-trigger the send.
  const seededQueryConsumedRef = useRef(false)

  const hasMessages = messages.length > 0
  const hasUnconsumedSeed = !!searchParams.get('q') && !seededQueryConsumedRef.current
  const isSeeding = hasUnconsumedSeed && !hasMessages

  // Clubs are greeted by name; people by first name (gender-neutral helper).
  const firstName = greetingName(profile)
  const exampleQueries = useMemo(
    () => exampleQueriesFor(profile ? { role: profile.role, coach_recruits_for_team: profile.coach_recruits_for_team } : null),
    [profile],
  )

  // Fill exactly the visible area above the iOS keyboard: visualViewport
  // changes height and offsetTop; both resize and scroll are listened to.
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

  useEffect(() => {
    if (seededQueryConsumedRef.current) return
    const q = searchParams.get('q')
    if (!q || !q.trim()) return
    seededQueryConsumedRef.current = true
    sendMessage(q.trim())
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchParams(next, { replace: true })
  }, [searchParams, sendMessage, setSearchParams])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      if (textareaRef.current) textareaRef.current.style.height = '44px'
    })
  }, [input, isPending, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFocus = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 300)
  }, [])

  const canSend = input.trim().length > 0 && !isPending

  return (
    <div
      ref={containerRef}
      className="fixed inset-x-0 top-0 z-30 flex flex-col bg-white"
      style={{ height: '100dvh' }}
    >
      {/* Nav bar: chevron · centred title · More */}
      <div className="shrink-0 border-b border-line bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto w-full max-w-md">
          <DetailNavBar
            parent="Home"
            title={HOCKIA_AI_TITLE}
            fallbackPath="/home"
            alwaysVisible
            trailing={
              <IconButton label="More" onClick={() => setMoreOpen(true)} data-testid="ai-more">
                <MoreHorizontal className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
              </IconButton>
            }
          />
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-md px-4 py-4">
          {isSeeding ? (
            <SearchingIndicator />
          ) : !hasMessages ? (
            <div className="flex flex-col items-center pt-10" data-testid="ai-first-use">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft" aria-hidden="true">
                <Sparkles className="h-7 w-7 text-hockia-primary" strokeWidth={1.75} />
              </span>
              <h2 className="mt-4 text-title text-ink-1">{firstName ? `Hi ${firstName}` : HOCKIA_AI_TITLE}</h2>
              <p className="mt-2 max-w-xs text-center text-secondary text-ink-3">{BETA_NOTE}</p>
              <div className="mt-8 w-full">
                <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-3">{TRY_ASKING_EYEBROW}</p>
                <ul className="flex flex-col gap-2">
                  {exampleQueries.map(example => (
                    <li key={example}>
                      <button
                        type="button"
                        data-testid="discover-example-query"
                        onClick={() => sendMessage(example)}
                        className="w-full rounded-[12px] border border-line bg-white px-4 py-3 text-left text-row text-ink-1 transition-colors active:bg-surface-muted"
                      >
                        &ldquo;{example}&rdquo;
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <DiscoverChat messages={messages} />
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-md items-end gap-2 px-4 py-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Ask Hockia AI</span>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => {
                if (e.target.value.length <= COMPOSER_MAX_LENGTH) setInput(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              placeholder={COMPOSER_PLACEHOLDER}
              rows={1}
              className="block max-h-[120px] min-h-[44px] w-full resize-none rounded-[22px] bg-surface-grouped px-4 py-[11px] text-row text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
              enterKeyHint="send"
              autoCapitalize="sentences"
              data-testid="ai-composer"
            />
          </label>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white transition-opacity disabled:opacity-40"
            data-testid="ai-send"
          >
            <ArrowUp className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      </div>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} ariaLabel="More">
        <ul className="px-2 pb-2 pt-1">
          <li>
            <button
              type="button"
              onClick={() => { clearChat(); setMoreOpen(false) }}
              className="flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted"
              data-testid="ai-clear"
            >
              <Trash2 className="h-5 w-5 text-ink-2" strokeWidth={1.75} aria-hidden="true" />
              Clear conversation
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => { setMoreOpen(false); setFeedbackOpen(true) }}
              className="flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted"
              data-testid="ai-report"
            >
              <Flag className="h-5 w-5 text-ink-2" strokeWidth={1.75} aria-hidden="true" />
              Report a problem
            </button>
          </li>
        </ul>
      </BottomSheet>

      {feedbackOpen && (
        <Suspense fallback={null}>
          <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
