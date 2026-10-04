import { lazy, Suspense, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp, Sparkles } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { SuggestionCard } from './SuggestionCard'
import { InviteLimitNotice } from './InviteAction'
import type { InviteSheetPlayer } from './InviteSheet'
import { useCountries } from '@/hooks/useCountries'
import { useRoleSuggestions } from '@/hooks/useRoleSuggestions'
import { useShortlistWrites } from '@/hooks/useScouting'
import { useClubInviteStatuses, useInviteAllowance } from '@/hooks/useInvites'
import { inviteLimitReason } from '@/lib/invites'
import { roleTitle } from '@/lib/opportunityCopy'
import { COMPOSER_MAX_LENGTH } from '@/lib/hockiaAi'
import {
  SUGGESTS_COMPOSER_PLACEHOLDER,
  SUGGESTS_EMPTY,
  SUGGESTS_FOOTNOTE,
  SUGGESTS_LOAD_ERROR,
  SUGGESTS_TITLE,
  flagsFor,
  suggestsIntro,
} from '@/lib/roleSuggestions'
import { suggestionReasons } from '@/lib/suggestionReasons'

// The invite sheet (D3.2) is its own chunk: opened on demand.
const InviteSheet = lazy(() => import('./InviteSheet'))

/**
 * D5.1 · Hockia suggests (Figma "New-Hockia" 398:83). Five players who fit
 * the role and haven't applied, ranked by fit then evidence — stored
 * server-side (role_suggestions) and recomputed nightly / on role change.
 * Each card: Muted star (shortlist to the role's list) and Tonal Invite (the
 * D3 sheet and its limits). The composer opens D5.2. Club-side only; phone.
 */
export default function HockiaSuggestsScreen({ roleId }: { roleId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { data, suggestions, loading, error } = useRoleSuggestions(roleId)
  const { countries } = useCountries()
  const role = data?.role ?? null
  const writes = useShortlistWrites(role?.title ?? null)
  const ids = useMemo(() => suggestions.map((s) => s.player_id), [suggestions])
  const inviteStatuses = useClubInviteStatuses(ids)
  const allowance = useInviteAllowance()
  const limitReason = allowance.reached ? inviteLimitReason(allowance.limit) : null
  const [inviteFor, setInviteFor] = useState<InviteSheetPlayer | null>(null)
  const [draft, setDraft] = useState('')
  const backLabel = role ? roleTitle({ position: role.position, title: role.title, opportunity_type: role.opportunity_type }) : 'Role'

  const ask = () => {
    const q = draft.trim()
    navigate(`/dashboard/opportunities/${roleId}/suggested/ask`, { state: { question: q || null, from: location.pathname } })
  }

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="hockia-suggests-screen">
      <DetailNavBar parent={backLabel} fallbackPath={`/dashboard/opportunities/${roleId}/applicants`} />
      <div className="px-5 pb-3 pt-0.5">
        <h1 className="flex items-center gap-2 text-[30px] font-bold leading-9 tracking-[-0.36px] text-ink-1">
          <Sparkles className="h-6 w-6 shrink-0 text-hockia-primary" strokeWidth={2} aria-hidden="true" />
          {SUGGESTS_TITLE}
        </h1>
        {role && <p className="pt-1 text-[14px] leading-[19px] text-ink-2" data-testid="suggests-intro">{suggestsIntro(role.title, suggestions.length)}</p>}
      </div>

      {limitReason && suggestions.length > 0 && <InviteLimitNotice reason={limitReason} />}
      {loading && <p className="px-5 py-4 text-row text-ink-3" aria-live="polite">Finding players…</p>}
      {error && !loading && <p className="px-5 py-3 text-row text-ink-2">{SUGGESTS_LOAD_ERROR}</p>}

      {!loading && !error && suggestions.length === 0 && (
        <div className="px-5 pt-2">
          <p className="rounded-card bg-surface-grouped p-4 text-row text-ink-2" role="status" data-testid="suggests-empty">{SUGGESTS_EMPTY}</p>
        </div>
      )}

      {suggestions.length > 0 && role && (
        <div className="flex flex-col gap-3 px-4 pt-1">
          {suggestions.map((s, i) => {
            const saved = writes.inList(s.player_id)
            return (
              <SuggestionCard
                key={s.player_id}
                suggestion={s}
                rank={i + 1}
                flags={flagsFor([s.nationality_country_id, s.nationality2_country_id], countries)}
                reasons={suggestionReasons(s.evidence, role)}
                shortlisted={saved}
                onToggleShortlist={() => void (saved ? writes.remove(s.player_id) : writes.add(s.player_id))}
                invitePill={inviteStatuses.pillFor(s.player_id)}
                inviteLimitReason={limitReason}
                onInvite={() => setInviteFor({ id: s.player_id, full_name: s.full_name, avatar_url: s.avatar_url, role: s.role, position: s.position, secondary_position: s.secondary_position })}
                onOpen={() => navigate(`/players/id/${s.player_id}`, { state: { from: location.pathname } })}
              />
            )
          })}
        </div>
      )}

      {!loading && !error && role && (
        <div className="px-4 pt-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); ask() }}
            data-testid="suggests-composer"
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ask Hockia about these players</span>
              <input
                value={draft}
                onChange={(e) => { if (e.target.value.length <= COMPOSER_MAX_LENGTH) setDraft(e.target.value) }}
                placeholder={SUGGESTS_COMPOSER_PLACEHOLDER}
                enterKeyHint="send"
                className="block h-11 w-full rounded-[22px] bg-surface-grouped px-4 text-row text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
                data-testid="suggests-composer-input"
              />
            </label>
            <button
              type="submit"
              aria-label="Ask Hockia"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white"
              data-testid="suggests-composer-send"
            >
              <ArrowUp className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
            </button>
          </form>
          <p className="pt-3 text-caption leading-4 text-ink-3" data-testid="suggests-footnote">{SUGGESTS_FOOTNOTE}</p>
        </div>
      )}

      {inviteFor && (
        <Suspense fallback={null}>
          <InviteSheet open={!!inviteFor} player={inviteFor} activeRoleId={roleId} onClose={() => setInviteFor(null)} />
        </Suspense>
      )}
    </div>
  )
}
