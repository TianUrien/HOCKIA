import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, Flag, MoreHorizontal, Trash2, X } from 'lucide-react'
import { useDiscoverChat } from '@/hooks/useDiscover'
import DiscoverChat from '@/components/DiscoverChat'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useAuthStore } from '@/lib/auth'
import { greetingName } from '@/lib/profile'
import { COMPOSER_MAX_LENGTH, HOCKIA_AI_TITLE, exampleQueriesFor } from '@/lib/hockiaAi'
import { SPRING, cssSpring, prefersReducedMotion } from '@/lib/spring'
import { hapticLight, hapticSelection } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { MascotAvatar, MascotClip, MascotHello } from './mascot'
import { useHockiaAiSheet } from './hockiaAiSheetStore'

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'))

const OPEN_EASE = cssSpring(SPRING.sheetOpen.response, SPRING.sheetOpen.damping)
const PLACEHOLDER = 'Ask Hockia AI…'

/** "LEARN" for questions, "FIND" for searches (Figma B2 / A1 eyebrows). */
function eyebrowFor(q: string): 'LEARN' | 'FIND' {
  return /^(how|what|when|why|is|can|do|does|should|which)\b/i.test(q.trim()) ? 'LEARN' : 'FIND'
}

function BetaPill() {
  return <span className="rounded-full bg-brand-soft px-2 py-[2px] text-caption font-semibold text-brand-primary" data-testid="hockia-ai-beta">Beta</span>
}

/**
 * Hockia AI sheet (handoff 2026-10-16, Figma 06 · B2 178:176, A1 174:117,
 * A2 175:50). A sheet over the current screen — never a tab — with two
 * detents: medium ≈ 62 % (the mascot's hello, what it can do from here,
 * three suggestions, the composer) and large (the conversation). Dragging
 * the grabber changes the detent or closes; tapping the dim closes.
 *
 * PR 1 scope (Tian, 16 Oct): the shell on today's Hockia AI answers
 * (useDiscoverChat — same engine, cards and daily limit as /discover). No
 * streaming, no action drafts, no attachments yet, so no "Do it for me"
 * suggestions and no "+" in the composer. Beta everywhere.
 */
export function HockiaAiSheet() {
  const { open, detent, setDetent, close } = useHockiaAiSheet()
  const { messages, sendMessage, clearChat, isPending } = useDiscoverChat()
  const profile = useAuthStore((s) => s.profile)
  const [input, setInput] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [drag, setDrag] = useState(0)
  const dragStart = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const reduced = prefersReducedMotion()
  useBodyScrollLock(open)

  const examples = useMemo(() => exampleQueriesFor(profile ? { role: profile.role, coach_recruits_for_team: profile.coach_recruits_for_team } : null), [profile])
  const firstName = greetingName(profile)
  const hasMessages = messages.length > 0

  useEffect(() => { if (open) void hapticLight() }, [open])
  useEffect(() => { if (hasMessages && open && detent === 'medium') setDetent('large') }, [hasMessages, open, detent, setDetent])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }) }, [messages, reduced])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !moreOpen && !feedbackOpen) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, moreOpen, feedbackOpen])

  const send = useCallback((text: string) => {
    const t = text.trim()
    if (!t || isPending) return
    sendMessage(t)
    setInput('')
    setDetent('large')
  }, [isPending, sendMessage, setDetent])

  // Grabber: drag down to step down (large → medium → closed), up to grow.
  const onPointerDown = (e: React.PointerEvent) => { dragStart.current = e.clientY; (e.target as HTMLElement).setPointerCapture?.(e.pointerId) }
  const onPointerMove = (e: React.PointerEvent) => { if (dragStart.current !== null) setDrag(Math.max(-120, e.clientY - dragStart.current)) }
  const onPointerUp = () => {
    if (dragStart.current === null) return
    const dy = drag
    dragStart.current = null
    setDrag(0)
    if (dy > 80) { if (detent === 'large') setDetent('medium'); else close() }
    else if (dy < -50 && detent === 'medium') setDetent('large')
    else if (Math.abs(dy) < 6) setDetent(detent === 'large' ? 'medium' : 'large')
  }

  if (!open) return null
  const large = detent === 'large'
  const canSend = input.trim().length > 0 && !isPending
  const suggestion = (q: string, i: number) => (
    <button key={q} type="button" onClick={() => { void hapticSelection(); send(q) }} className="flex min-h-[48px] w-full items-center gap-3 rounded-[16px] border border-line bg-white px-4 py-3 text-left transition-colors hover:bg-surface-subtle" data-testid="hockia-ai-suggestion" data-index={i}>
      <span className="shrink-0 text-caption font-semibold tracking-[0.04em] text-ink-3">{eyebrowFor(q)}</span>
      <span className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-ink-1">{q}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70]" data-testid="hockia-ai-sheet-root">
      {/* Dim behind the sheet; a tap closes it (the X and Escape do too). */}
      <div aria-hidden="true" onClick={close} className="absolute inset-0" style={{ backgroundColor: 'rgba(15,15,20,0.4)' }} data-testid="hockia-ai-dim" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${HOCKIA_AI_TITLE}, beta`}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-w-[560px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(15,15,20,0.18)] lg:bottom-4 lg:rounded-[28px]"
        style={{
          height: large ? 'calc(100dvh - env(safe-area-inset-top) - 12px)' : '62dvh',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top) - 12px)',
          transform: `translateY(${Math.max(0, drag)}px)`,
          transition: dragStart.current !== null || reduced ? 'none' : `height 480ms ${OPEN_EASE}, transform 420ms ${OPEN_EASE}`,
          backgroundImage: 'linear-gradient(180deg, rgba(241,234,253,0.9) 0%, rgba(255,255,255,1) 34%)',
        }}
        data-testid="hockia-ai-sheet"
        data-detent={detent}
      >
        <div className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} data-testid="hockia-ai-grabber" aria-hidden="true">
          <span className="h-[5px] w-10 rounded-full bg-ink-4/60" />
        </div>

        {large ? (
          <div className="flex shrink-0 items-center justify-between px-4 pb-2">
            <button type="button" onClick={() => setMoreOpen(true)} aria-label="More" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" data-testid="hockia-ai-more">
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
            </button>
            <span className="flex items-center gap-2 text-[17px] font-semibold text-ink-1">{HOCKIA_AI_TITLE} <BetaPill /></span>
            <button type="button" onClick={close} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" data-testid="hockia-ai-close">
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {!large && (
            <div className="flex flex-col gap-3 pb-3" data-testid="hockia-ai-medium">
              <div className="flex items-start gap-3">
                <MascotHello height={96} className="-ml-1 shrink-0" />
                <div className="min-w-0 flex-1 pt-3">
                  <p className="flex items-center gap-2 text-[22px] font-bold leading-7 text-ink-1">{HOCKIA_AI_TITLE} <BetaPill /></p>
                  <p className="mt-1 text-[15px] leading-5 text-ink-2">I see you’re browsing roles. Ask me to find the ones that fit you, or anything about hockey.</p>
                </div>
              </div>
              {examples.slice(0, 3).map(suggestion)}
            </div>
          )}

          {large && !hasMessages && (
            <div className="flex flex-col items-center pb-4 text-center" data-testid="hockia-ai-home">
              <MascotHello height={200} />
              <h2 className="mt-3 text-[26px] font-bold leading-8 tracking-[-0.01em] text-ink-1">{firstName ? `Hi ${firstName}, I’m Hockia AI` : 'Hi, I’m Hockia AI'}</h2>
              <p className="mt-2 max-w-[340px] text-[16px] leading-[22px] text-ink-2">Your field hockey teammate. Ask me anything about roles, clubs, players or the game.</p>
              <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
                {examples.slice(0, 4).map((q, i, all) => (
                  <button key={q} type="button" onClick={() => { void hapticSelection(); send(q) }} className={cn('flex min-h-[96px] flex-col items-start rounded-[16px] border border-line bg-white p-3.5 text-left transition-colors hover:bg-surface-subtle', all.length % 2 === 1 && i === all.length - 1 && 'col-span-2')} data-testid="hockia-ai-card">
                    <span className="text-caption font-semibold tracking-[0.04em] text-ink-3">{eyebrowFor(q)}</span>
                    <span className="mt-1 text-[15px] font-semibold leading-5 text-ink-1">{q}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {large && hasMessages && (
            <div className="pb-4 pt-1" data-testid="hockia-ai-conversation">
              <DiscoverChat messages={messages} assistantAvatar={<MascotAvatar state="calm" size={36} ring />} />
              {isPending && (
                <div className="mt-4 flex items-center gap-2.5" role="status" aria-label="Thinking" data-testid="hockia-ai-thinking">
                  <span className="flex h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-full"><MascotClip clip="avatar_thinking_loop" loop height={42} /></span>
                  <span className="text-[15px] font-semibold text-brand-primary">Thinking…</span>
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
          <div className="flex items-end gap-2 rounded-[28px] border border-line bg-white p-1.5 pl-4 shadow-[0_2px_10px_rgba(15,15,20,0.06)]">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ask Hockia AI</span>
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => { if (e.target.value.length <= COMPOSER_MAX_LENGTH) setInput(e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
                onFocus={() => { if (!large) setDetent('large') }}
                placeholder={PLACEHOLDER}
                className="block max-h-[120px] min-h-[40px] w-full resize-none bg-transparent py-[9px] text-[17px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:outline-none"
                enterKeyHint="send"
                data-testid="hockia-ai-composer"
              />
            </label>
            <button type="button" onClick={() => send(input)} disabled={!canSend} aria-label="Send" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white transition-opacity', !canSend && 'opacity-40')} data-testid="hockia-ai-send">
              <ArrowUp className="h-5 w-5" strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </section>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} ariaLabel="More">
        <ul className="px-2 pb-2 pt-1">
          <li>
            <button type="button" onClick={() => { clearChat(); setMoreOpen(false); setDetent('large') }} className="flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted" data-testid="hockia-ai-clear">
              <Trash2 className="h-5 w-5 text-ink-2" strokeWidth={1.75} /> Clear conversation
            </button>
          </li>
          <li>
            <button type="button" onClick={() => { setMoreOpen(false); setFeedbackOpen(true) }} className="flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted" data-testid="hockia-ai-report">
              <Flag className="h-5 w-5 text-ink-2" strokeWidth={1.75} /> Report a problem
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
