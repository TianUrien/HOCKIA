import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { Chip } from '@/components/ui/Chip'
import { FitChip } from './FitChip'
import { InviteAction, InviteLimitNotice } from './InviteAction'
import type { InviteSheetPlayer } from './InviteSheet'
import { UserBubble } from '@/components/discover/UserBubble'
import SoftErrorCard from '@/components/discover/SoftErrorCard'
import { SearchingIndicator } from '@/components/discover/AssistantMessage'
import { useCountries } from '@/hooks/useCountries'
import { useRoleSuggestions } from '@/hooks/useRoleSuggestions'
import { useSuggestRefine } from '@/hooks/useSuggestRefine'
import { useClubInviteStatuses, useInviteAllowance } from '@/hooks/useInvites'
import { getImageUrl } from '@/lib/imageUrl'
import { inviteLimitReason } from '@/lib/invites'
import { nationalityLine, type CountryLite } from '@/lib/findPlayers'
import { CAP_REACHED_COPY, COMPOSER_MAX_LENGTH, CONNECTION_ERROR_COPY, TRY_AGAIN_CHIP } from '@/lib/hockiaAi'
import {
  REFINE_BACK,
  REFINE_COMPOSER_PLACEHOLDER,
  REFINE_NO_MATCH,
  REFINE_TITLE,
  refineCaption,
  type RoleSuggestion,
} from '@/lib/roleSuggestions'
import { monthYear } from '@/lib/suggestionReasons'

const InviteSheet = lazy(() => import('./InviteSheet'))

/** "Serie A Elite · EU passport · Available from January 2027" — profile facts only. */
function factsLine(s: RoleSuggestion): string | null {
  const ev = s.evidence
  const avail = ev.available_from ? monthYear(ev.available_from) : null
  const parts = [ev.league_name, ev.eu_passport ? 'EU passport' : null, avail ? `From ${avail}` : null].filter((p): p is string => !!p)
  return parts.length ? parts.join(' · ') : null
}

/**
 * D5.2 · Hockia AI refine (Figma "New-Hockia" 398:291). The club asks about
 * the role's stored suggestions; nl-search (mode role_suggestions_refine)
 * filters / re-orders ONLY those players using their profile facts and says
 * what it can't confirm. Matches are player rows with Invite (no message
 * button). Reuses the Hockia AI v2 bubble, chips, neutral error card and cap
 * card. Counts toward the same daily question cap. Club-side only; phone.
 */
export default function SuggestRefineScreen({ roleId }: { roleId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const seed = (location.state as { question?: string | null } | null)?.question ?? null
  const { suggestions, loading } = useRoleSuggestions(roleId)
  const poolIds = useMemo(() => suggestions.map((s) => s.player_id), [suggestions])
  const { turns, pending, ask } = useSuggestRefine(roleId, poolIds)
  const { countries } = useCountries()
  const inviteStatuses = useClubInviteStatuses(poolIds)
  const allowance = useInviteAllowance()
  const limitReason = allowance.reached ? inviteLimitReason(allowance.limit) : null
  const [input, setInput] = useState('')
  const [inviteFor, setInviteFor] = useState<InviteSheetPlayer | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // The question typed on D5.1 is sent once, as soon as the suggestions are loaded.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !seed || loading) return
    seeded.current = true
    void ask(seed)
  }, [seed, loading, ask])

  useEffect(() => { bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' }) }, [turns, pending])

  const send = (q: string) => {
    if (!q.trim() || pending) return
    void ask(q)
    setInput('')
  }

  return (
    // Full screen above the tab bar, like Hockia AI (DiscoverPage): Figma D5.2 has no tab bar.
    <div className="fixed inset-x-0 top-0 z-30 flex h-[100dvh] flex-col bg-white lg:hidden" data-testid="suggest-refine-screen">
      <div className="shrink-0 border-b border-line bg-white pt-[env(safe-area-inset-top)]">
      <DetailNavBar parent={REFINE_BACK} title={REFINE_TITLE} showParent fallbackPath={`/dashboard/opportunities/${roleId}/suggested`} />
      </div>
      {limitReason && <InviteLimitNotice reason={limitReason} />}

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
        <div className="flex flex-col gap-4">
          {turns.map((t, ti) => {
            const last = ti === turns.length - 1
            const a = t.answer
            const matches = a?.kind === 'answer' ? a.matchIds.map((id) => suggestions.find((s) => s.player_id === id)).filter((s): s is RoleSuggestion => !!s) : []
            return (
              <div key={t.id} className="flex flex-col gap-3">
                <UserBubble text={t.question} />
                {!a && <SearchingIndicator />}
                {a?.kind === 'cap_reached' && (
                  <SoftErrorCard message={a.message || CAP_REACHED_COPY} suggestedActions={[]} onAction={() => undefined} />
                )}
                {a?.kind === 'error' && (
                  <SoftErrorCard
                    message={CONNECTION_ERROR_COPY}
                    suggestedActions={last ? [TRY_AGAIN_CHIP] : []}
                    onAction={() => send(t.question)}
                  />
                )}
                {a?.kind === 'answer' && (
                  <div data-testid="refine-answer">
                    <p className="whitespace-pre-line text-body leading-[22px] text-ink-1">{a.message || REFINE_NO_MATCH}</p>
                    {matches.length > 0 && (
                      <div className="pt-2">
                        {matches.map((s) => {
                          const avatar = s.avatar_url ? getImageUrl(s.avatar_url, 'avatar-md') ?? s.avatar_url : null
                          const nat = nationalityLine([s.nationality_country_id, s.nationality2_country_id], countries as CountryLite[])
                          const facts = factsLine(s)
                          return (
                            <div key={s.player_id} className="flex items-center gap-3 py-3" data-testid="refine-match-row">
                              <button type="button" onClick={() => navigate(`/players/id/${s.player_id}`, { state: { from: location.pathname } })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                <EntityAvatar src={avatar} name={s.full_name} role="player" size={52} className="shrink-0 self-start" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{s.full_name || 'Player'}</span>
                                  {facts && <span className="block truncate text-[14px] leading-[19px] text-ink-2">{facts}</span>}
                                  <span className="flex items-center gap-2 pt-[3px]">
                                    <span className="shrink-0 empty:hidden"><FitChip state={s.fit_state} /></span>
                                    {nat && <span className="min-w-0 truncate text-secondary text-ink-2">{nat}</span>}
                                  </span>
                                </span>
                              </button>
                              <span className="shrink-0">
                                <InviteAction
                                  pill={inviteStatuses.pillFor(s.player_id)}
                                  invitable
                                  limitReason={limitReason}
                                  onInvite={() => setInviteFor({ id: s.player_id, full_name: s.full_name, avatar_url: s.avatar_url, role: s.role, position: s.position, secondary_position: s.secondary_position })}
                                />
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <p className="pt-2 text-caption leading-4 text-ink-3" data-testid="refine-caption">{refineCaption(suggestions.length)}</p>
                    {last && a.chips.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Suggested next questions">
                        {a.chips.map((c) => <Chip key={c} label={c} onClick={() => send(c)} data-testid="refine-chip" />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {turns.length === 0 && !pending && (
            <p className="text-secondary text-ink-3" data-testid="refine-intro">{refineCaption(suggestions.length)}</p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        <form className="flex items-end gap-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Ask Hockia AI</span>
            <input
              value={input}
              onChange={(e) => { if (e.target.value.length <= COMPOSER_MAX_LENGTH) setInput(e.target.value) }}
              placeholder={REFINE_COMPOSER_PLACEHOLDER}
              enterKeyHint="send"
              className="block h-11 w-full rounded-[22px] bg-surface-grouped px-4 text-row text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
              data-testid="refine-composer"
            />
          </label>
          <button
            type="submit"
            disabled={!input.trim() || pending}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white disabled:opacity-40"
            data-testid="refine-send"
          >
            <ArrowUp className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </form>
      </div>

      {inviteFor && (
        <Suspense fallback={null}>
          <InviteSheet open={!!inviteFor} player={inviteFor} activeRoleId={roleId} onClose={() => setInviteFor(null)} />
        </Suspense>
      )}
    </div>
  )
}
