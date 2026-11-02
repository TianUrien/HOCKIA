import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BetaPill } from './BetaPill'
import { ArrowUp, Check, ChevronRight, Flag, History, Loader2, MessageSquare, MoreHorizontal, SquarePen, UserRoundPen, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDiscoverChat } from '@/hooks/useDiscover'
import DiscoverChat from '@/components/DiscoverChat'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useAuthStore } from '@/lib/auth'
import { greetingName } from '@/lib/profile'
import { CHECK_PROFILE_AGAINST_ROLE, COMPOSER_MAX_LENGTH, HOCKIA_AI_TITLE, aiIntroFor, exampleQueriesFor, isRecruiterProfile } from '@/lib/hockiaAi'
import { useRecruitingContext } from '@/hooks/useRecruitingContext'
import { SPRING, cssSpring, prefersReducedMotion } from '@/lib/spring'
import { hapticLight, hapticSelection } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { MascotAvatar, MascotClip, MascotHello } from './mascot'
import { useHockiaAiSheet } from './hockiaAiSheetStore'
import { useWordReveal } from './useWordReveal'
import { ProfileBuilder } from './ProfileBuilder'
import { ApplyFlow } from './ApplyFlow'
import { ChatHistory } from './ChatHistory'
import { NextStepPlan, NextSteps } from './NextSteps'
import { useNextSteps } from './useNextSteps'
import { useAiContextChip } from './useAiContextChip'
import { aiContextChipLabel, goalIntro } from '@/lib/hockiaAiContext'
import { RoleApplyActionContext } from '@/components/discover/roleApplyAction'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'
import type { AiStep } from '@/lib/aiStream'
import { HockiaAiOffer } from '@/components/offers/HockiaAiOffer'
import { hockiaAiOfferTopic } from '@/lib/memberOffers'

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'))

const OPEN_EASE = cssSpring(SPRING.sheetOpen.response, SPRING.sheetOpen.damping)
const PLACEHOLDER = 'Ask Hockia AI…'

/** "LEARN" for questions, "FIND" for searches (Figma B2 / A1 eyebrows). */
function eyebrowFor(q: string): 'LEARN' | 'FIND' {
  return /^(how|what|when|why|is|can|do|does|should|which)\b/i.test(q.trim()) ? 'LEARN' : 'FIND'
}

/**
 * Hockia AI sheet (handoff 2026-10-16, Figma 06 · B2 178:176, A1 174:117,
 * A2 175:50). A sheet over the current screen — never a tab — with two
 * detents: medium ≈ 62 % (the mascot's hello, what it can do from here,
 * three suggestions, the composer) and large (the conversation). Dragging
 * the grabber changes the detent or closes; tapping the dim closes.
 *
 * PR 1 scope (founder, 16 Oct): the shell on today's Hockia AI answers
 * (useDiscoverChat — same engine, cards and daily limit as /discover). No
 * streaming, no action drafts, no attachments yet, so no "Do it for me"
 * suggestions and no "+" in the composer. Beta everywhere.
 */
export function HockiaAiSheet() {
  const { open, detent, setDetent, close, mode, setMode, applyTarget, prepareApplication, roleContext, clearRole, step, startStep, seed, takeSeed } = useHockiaAiSheet()
  const { messages, sendMessage, clearChat, openChat, isPending, steps, revealId, finishReveal, contextOff, setContextOff, setGoalOn } = useDiscoverChat()
  const profile = useAuthStore((s) => s.profile)
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  // Brand offer under a finished answer (Figma 08 · Brands P2 H3): only an
  // answer that just finished in this chat (never one reloaded from history),
  // only on the founder's topics, at most one per chat.
  const [aiOffer, setAiOffer] = useState<{ answerId: string; topic: string } | null>(null)
  const prevReveal = useRef<string | null>(null)
  const firstMessageId = messages[0]?.id ?? null
  useEffect(() => { setAiOffer(null) }, [firstMessageId])
  useEffect(() => {
    const finished = prevReveal.current
    prevReveal.current = revealId
    if (!finished || revealId || isPending || aiOffer) return
    const i = messages.findIndex((m) => m.id === finished)
    const answer = messages[i]
    if (!answer || answer.role !== 'assistant' || answer.status !== 'complete') return
    const question = messages[i - 1]?.role === 'user' ? messages[i - 1].content : answer.search_query ?? null
    const topic = hockiaAiOfferTopic(question)
    if (topic) setAiOffer({ answerId: answer.id, topic })
  }, [revealId, isPending, messages, aiOffer])
  const [moreOpen, setMoreOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [drag, setDrag] = useState(0)
  const dragStart = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const reduced = prefersReducedMotion()
  useBodyScrollLock(open)

  // Recruiters: "Find available players for <role>" names the active recruiting role (audit A7).
  const { active: recruitingRole } = useRecruitingContext()
  const recruiter = isRecruiterProfile(profile ? { role: profile.role, coach_recruits_for_team: profile.coach_recruits_for_team } : null)
  const activeRoleTitle = recruiter ? recruitingRole?.label ?? null : null
  const examples = useMemo(() => exampleQueriesFor(profile ? { role: profile.role, coach_recruits_for_team: profile.coach_recruits_for_team } : null, activeRoleTitle), [profile, activeRoleTitle])
  const firstName = greetingName(profile)
  // "Fill my profile for me" (handoff P0–P3): players and coaches (ruling 2026-10-18).
  const canBuild = profile?.role === 'player' || profile?.role === 'coach'
  const builder = mode === 'builder' && canBuild
  // "Prepare my application" (handoff A4): players and coaches, from a role result.
  const applying = mode === 'apply' && canBuild && applyTarget !== null
  // Saved chats (handoff C2): signed-in members only — chats live on the account.
  const history = mode === 'history' && signedIn
  // Next steps (founder, 2026-10-18): Hockia AI proposes what helps the profile most.
  const { facts, steps: nextSteps } = useNextSteps(open && canBuild)
  const stepping = mode === 'steps' && canBuild && step !== null
  const plan = canBuild && !roleContext && nextSteps && nextSteps.length > 0 ? nextSteps : null
  const special = builder || applying || history || stepping
  const startBuilder = () => { void hapticSelection(); setMode('builder') }
  const hasMessages = messages.length > 0
  // Context chip (rebrand page 17): what Hockia AI is looking at; ✕ = this chat only.
  const contextChip = useAiContextChip(open && signedIn)
  // The server reads the private goal only while the goal chip shows.
  const goalInUse = contextChip?.kind === 'goal' && !contextOff && !roleContext
  useEffect(() => { setGoalOn(goalInUse) }, [goalInUse, setGoalOn])

  useEffect(() => { if (open) void hapticLight() }, [open])
  useEffect(() => { if ((hasMessages || special) && open && detent === 'medium') setDetent('large') }, [hasMessages, special, open, detent, setDetent])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }) }, [messages, reduced])
  useEffect(() => {
    if (!open) return
    // A sheet opened over the builder (attach menu) handles its own Escape.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !moreOpen && !feedbackOpen && !document.querySelector('[data-testid="builder-attach-menu"]')) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, moreOpen, feedbackOpen])

  const send = useCallback((text: string) => {
    const t = text.trim()
    if (!t || isPending) return
    // Opened on a role (handoff B4): questions are about that role.
    sendMessage(t, roleContext ? { mode: 'role_ask', opportunity_id: roleContext.id } : undefined, roleContext ? { roleLabel: roleContext.label } : undefined)
    setInput('')
    setDetent('large')
  }, [isPending, sendMessage, setDetent, roleContext])

  // Opened with text (Search, the Home bar, an old /discover?q= link): send
  // what the member already asked, or leave a link's text in the composer.
  // takeSeed clears it, so a Strict-Mode re-run or a reopen never resends.
  useEffect(() => {
    if (!open || !seed || isPending) return
    const s = takeSeed()
    if (!s) return
    if (s.send) send(s.text)
    else { setInput(s.text.slice(0, COMPOSER_MAX_LENGTH)); inputRef.current?.focus() }
  }, [open, seed, isPending, takeSeed, send])

  // Grabber: drag down to step down (large → medium → closed), up to grow.
  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientY
    // A pointer that's already gone (cancelled touch) can't be captured; the drag still works.
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* no active pointer */ }
  }
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
  const askFromPlan = (text: string) => { setMode('chat'); setTimeout(() => send(text), 0) }
  const planCard = plan ? <NextStepPlan steps={plan} question="Where should we start?" onPick={startStep} onOther={askFromPlan} /> : null
  const canSend = input.trim().length > 0 && !isPending
  const buildChip = canBuild ? (
    <button type="button" onClick={startBuilder} className="flex min-h-[48px] w-full items-center gap-3 rounded-[16px] border border-brand-primary/30 bg-brand-soft px-4 py-3 text-left" data-testid="hockia-ai-fill-profile">
      <UserRoundPen className="h-5 w-5 shrink-0 text-brand-primary" strokeWidth={1.9} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-5 text-ink-1">Fill my profile for me</span>
        <span className="block text-caption text-ink-2">From your CV, photos, links or a few lines</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-brand-primary" strokeWidth={2} />
    </button>
  ) : null
  // Figma B4 178:603: three suggestions for the open role.
  const roleSuggestions = roleContext ? [
    { eyebrow: 'ASK', label: CHECK_PROFILE_AGAINST_ROLE, run: () => send(CHECK_PROFILE_AGAINST_ROLE) },
    ...(canBuild ? [{ eyebrow: 'DO IT FOR ME', label: 'Prepare my application', run: () => prepareApplication(roleContext) }] : []),
    { eyebrow: 'LEARN', label: roleContext.city ? `What is life in ${roleContext.city} like for a player?` : 'What should I ask the club?', run: () => send(roleContext.city ? `What is life in ${roleContext.city} like for a player?` : 'What should I ask the club about this opportunity?') },
  ] : []
  const roleChip = roleContext ? (
    <span className="mx-auto flex max-w-full items-center gap-2 rounded-full bg-white py-1 pl-1.5 pr-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" data-testid="hockia-ai-role-chip">
      <img src={roleContext.logoUrl ?? undefined} alt="" className={cn('h-6 w-6 rounded-full object-contain', !roleContext.logoUrl && 'hidden')} />
      <span className="truncate text-secondary font-semibold text-ink-1">{roleContext.label}</span>
      <button type="button" onClick={clearRole} aria-label="Stop asking about this opportunity" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3"><X className="h-3.5 w-3.5" /></button>
    </span>
  ) : null
  const goalChip = contextChip?.kind === 'goal'
  const intro = roleContext ? 'Ask me anything about this opportunity. I already have it open.'
    : plan ? 'I can finish your profile with you. I do the work; you choose.'
    : goalChip ? goalIntro(!contextOff)
    : aiIntroFor(profile ? { role: profile.role, coach_recruits_for_team: profile.coach_recruits_for_team } : null)
  const chip = contextChip && !contextOff && !roleContext ? (
    <span className="flex max-w-full items-center gap-2 self-start rounded-full border border-line bg-white py-1.5 pl-3 pr-2.5 lg:self-center" data-testid="hockia-ai-context-chip">
      <span className="truncate text-caption text-ink-1">{aiContextChipLabel(contextChip)}</span>
      <button type="button" onClick={() => { void hapticSelection(); setContextOff(true) }} aria-label="Remove context" className="relative flex h-4 w-4 shrink-0 items-center justify-center text-ink-3 before:absolute before:-inset-3.5 before:content-['']" data-testid="hockia-ai-context-chip-remove">
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </span>
  ) : null
  const roleSuggestion = (r: { eyebrow: string; label: string; run: () => void }) => (
    <button key={r.label} type="button" onClick={() => { void hapticSelection(); r.run() }} className="flex min-h-[48px] w-full items-center gap-3 rounded-[16px] border border-line bg-white px-4 py-3 text-left transition-colors hover:bg-surface-subtle" data-testid="hockia-ai-role-suggestion">
      <span className={cn('shrink-0 text-caption font-semibold tracking-[0.04em]', r.eyebrow === 'DO IT FOR ME' ? 'text-brand-primary' : 'text-ink-3')}>{r.eyebrow}</span>
      <span className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-ink-1">{r.label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
    </button>
  )
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
          // Chats (C2) is a plain surface; the chat has the mind-light wash.
          backgroundImage: history ? 'none' : 'linear-gradient(180deg, rgba(241,234,253,0.9) 0%, rgba(255,255,255,1) 34%)',
        }}
        data-testid="hockia-ai-sheet"
        data-detent={detent}
      >
        <div className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} data-testid="hockia-ai-grabber" aria-hidden="true">
          <span className="h-[5px] w-10 rounded-full bg-ink-4/60 lg:hidden" />
        </div>

        {large && !history ? (
          <div className="flex shrink-0 items-center justify-between px-4 pb-2">
            {special ? (
              <button type="button" onClick={() => setMode('chat')} aria-label="Back to the chat" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" data-testid="hockia-ai-to-chat">
                <MessageSquare className="h-5 w-5" strokeWidth={2} />
              </button>
            ) : (
              <button type="button" onClick={() => setMoreOpen(true)} aria-label="More" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" data-testid="hockia-ai-more">
                <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
              </button>
            )}
            <span className="flex items-center gap-2 text-[17px] font-semibold text-ink-1">{HOCKIA_AI_TITLE} <BetaPill /></span>
            <button type="button" onClick={close} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" data-testid="hockia-ai-close">
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
        ) : null}

        {stepping && step ? (
          <NextSteps key={step} step={step} facts={facts} steps={nextSteps ?? []} onStep={startStep} onAsk={askFromPlan} onClose={close} />
        ) : history ? (
          <ChatHistory
            onBack={() => setMode('chat')}
            onNewChat={() => { clearChat(); setMode('chat') }}
            onClose={close}
            onOpenChat={async (row) => {
              await openChat(row.id, row.kind === 'role' ? row.summary : null)
              // An old chat is its own conversation, not about the role this sheet was opened on.
              clearRole()
              setMode('chat')
            }}
            onOpenLink={(link) => { close(); navigate(link) }}
          />
        ) : applying && applyTarget ? (
          <ApplyFlow
            key={applyTarget.id}
            target={applyTarget}
            onClose={close}
            onAddVideo={() => setMode('builder')}
            onFindSimilar={(q) => { setMode('chat'); setTimeout(() => send(q), 0) }}
          />
        ) : builder ? <ProfileBuilder onClose={close} /> : (<>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {!large && (
            <div className="flex flex-col gap-3 pb-3" data-testid="hockia-ai-medium">
              <div className="flex items-start gap-3">
                <MascotHello height={96} className="-ml-1 shrink-0" />
                <div className="min-w-0 flex-1 pt-3">
                  <p className="flex items-center gap-2 text-[22px] font-bold leading-7 text-ink-1">{HOCKIA_AI_TITLE} <BetaPill /></p>
                  <p className="mt-1 text-[15px] leading-5 text-ink-2" data-testid="hockia-ai-intro">{intro}</p>
                </div>
              </div>
              {chip}
              {roleContext ? (
                <>
                  {roleChip}
                  {roleSuggestions.map(roleSuggestion)}
                </>
              ) : (
                <>
                  {planCard ?? buildChip}
                  {examples.slice(0, planCard ? 1 : canBuild ? 2 : 3).map(suggestion)}
                </>
              )}
            </div>
          )}

          {large && !hasMessages && (
            <div className="flex flex-col items-center pb-4 text-center" data-testid="hockia-ai-home">
              <MascotHello height={200} />
              <h2 className="mt-3 text-[26px] font-bold leading-8 tracking-[-0.01em] text-ink-1">{firstName ? `Hi ${firstName}, I’m Hockia AI` : 'Hi, I’m Hockia AI'}</h2>
              <p className="mt-2 max-w-[340px] text-[16px] leading-[22px] text-ink-2">Your field hockey teammate. Ask me anything about opportunities, clubs, players or the game.</p>
              {chip && <div className="mt-4 flex justify-center">{chip}</div>}
              {roleContext && <div className="mt-5 flex w-full flex-col gap-2.5">{roleChip}{roleSuggestions.map(roleSuggestion)}</div>}
              {!roleContext && (planCard ?? buildChip) && <div className="mt-5 w-full text-left">{planCard ?? buildChip}</div>}
              <div className={cn('grid w-full grid-cols-2 gap-2.5', roleContext && 'hidden', buildChip ? 'mt-2.5' : 'mt-5')}>
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
              <RoleApplyActionContext.Provider value={canBuild ? (r) => prepareApplication({ id: r.id, title: r.title, organization: r.organization, logoUrl: r.logo_url }) : null}>
                <RevealingChat messages={messages} revealId={revealId} onRevealed={finishReveal} afterAnswer={(m) => (aiOffer && m.id === aiOffer.answerId ? <HockiaAiOffer answerId={aiOffer.answerId} topic={aiOffer.topic} role={profile?.role ?? null} /> : null)} />
              </RoleApplyActionContext.Provider>
              {isPending && <ThinkingSteps steps={steps} />}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
          {roleContext && large && hasMessages && <div className="mb-2 flex">{roleChip}</div>}
          {chip && large && hasMessages && <div className="mb-2 flex">{chip}</div>}
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
        </>)}
      </section>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} ariaLabel="More">
        <ul className="px-2 pb-2 pt-1">
          <li>
            <button type="button" onClick={() => { clearChat(); setMoreOpen(false); setDetent('large') }} className="flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted" data-testid="hockia-ai-clear">
              <SquarePen className="h-5 w-5 text-ink-2" strokeWidth={1.75} /> New chat
            </button>
          </li>
          {signedIn && (
            <li>
              <button type="button" onClick={() => { setMoreOpen(false); setMode('history') }} className="flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted" data-testid="hockia-ai-chats">
                <History className="h-5 w-5 text-ink-2" strokeWidth={1.75} /> Your chats
              </button>
            </li>
          )}
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

/** "Thinking…" with the live steps from the server: done ✓, now spinner (handoff A2). Never a silent wait. */
function ThinkingSteps({ steps }: { steps: AiStep[] }) {
  return (
    <div className="mt-4 flex items-start gap-2.5" role="status" aria-live="polite" aria-label="Thinking" data-testid="hockia-ai-thinking">
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full"><MascotClip clip="avatar_thinking_loop" loop height={42} /></span>
      <div className="min-w-0 flex-1 pt-2">
        <p className="text-[15px] font-semibold text-brand-primary">Thinking…</p>
        {steps.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5" data-testid="hockia-ai-steps">
            {steps.map((st) => (
              <li key={st.id} className="flex items-center gap-2 text-[14px] leading-[19px] text-ink-2" data-state={st.state} data-testid="hockia-ai-step">
                {st.state === 'done'
                  ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-positive text-white"><Check className="h-2.5 w-2.5" strokeWidth={3.5} /></span>
                  : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-primary" strokeWidth={2.2} />}
                <span className={st.state === 'now' ? 'text-ink-1' : undefined}>{st.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * The conversation with the newest answer revealed word by word; its cards,
 * chips and results appear once the words are in (handoff: answers stream).
 */
function RevealingChat({ messages: all, revealId, onRevealed, afterAnswer }: { messages: DiscoverChatMessage[]; revealId: string | null; onRevealed: () => void; afterAnswer?: (msg: DiscoverChatMessage) => ReactNode }) {
  // The in-flight placeholder is replaced by the live steps below the chat.
  const messages = useMemo(() => all.filter((m) => m.status !== 'sending'), [all])
  const target = revealId ? messages.find((m) => m.id === revealId) ?? null : null
  const partial = useWordReveal(target?.content ?? '', Boolean(target), onRevealed)
  const shown = useMemo(() => {
    if (!target) return messages
    const done = partial === target.content
    // While the words come in, show the message as plain text (kind 'text'):
    // a results / no-results card with its rows held back would read wrong.
    return messages.map((m) => (m.id !== target.id ? m : done ? m : {
      ...m,
      kind: 'text' as const,
      content: partial,
      results: undefined, recommendations: undefined, opportunities: undefined,
      suggested_actions: undefined, clarifying_options: undefined, cta: undefined, secondary_note: undefined,
    }))
  }, [messages, target, partial])
  return <DiscoverChat messages={shown} assistantAvatar={<MascotAvatar state="calm" size={36} ring />} afterAnswer={afterAnswer} />
}
