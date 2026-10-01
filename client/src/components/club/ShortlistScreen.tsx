import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, Lock, MessageCircle, Star } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { ScoutPlayerRow } from './ScoutPlayerRow'
import { RankedForSheet } from './RankedForSheet'
import { UndoToast } from './UndoToast'
import { InviteAction, InviteLimitNotice } from './InviteAction'
import type { InviteSheetPlayer } from './InviteSheet'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { useOwnLeague, useRoleShortlist, useScoutingContext, useShortlistEntryActions, type ShortlistEntry } from '@/hooks/useScouting'
import { useRecruitingViewKind } from '@/hooks/useRecruitingContext'
import { useClubInviteStatuses, useInviteAllowance } from '@/hooks/useInvites'
import { inviteLimitReason, isInvitablePlayer } from '@/lib/invites'
import {
  contextFitTarget,
  contextPillLabel,
  playerContexts,
  rankScoutRows,
  shortlistHeaderLine,
  shortlistSourceLine,
  type ContextLike,
} from '@/lib/findPlayers'
import { cn } from '@/lib/utils'

/**
 * Shortlist — club v2 (Figma 04 Club D1.10 332:539; DEV NOTE 332:746), one
 * per role (founder ruling 2026-09-25 #9): the players the club scouted for
 * the active role (its saved_profiles list) and the applicants it
 * shortlisted on that role, each with where it came from and the club's
 * private note. Long-press a row for Add note · Remove. Nothing here is
 * visible to the player and no notification is sent.
 */
type Chip = 'all' | 'applied' | 'scouted'
const NOTE_MAX = 500
// The invite sheet (D3.2) is its own chunk: opened on demand.
const InviteSheet = lazy(() => import('./InviteSheet'))

export default function ShortlistScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  // Only PLAYER roles rank players here (round 6): a coach-role context
  // stays stored for the Coaches tab.
  useRecruitingViewKind('player')
  const scouting = useScoutingContext()
  const { ctx, roleTitle, openRoles } = scouting
  const roleId = ctx?.type === 'opportunity' ? ctx.opportunity_id : null
  const { countries } = useCountries()
  const target = contextFitTarget(ctx)
  const ownLeague = useOwnLeague(target)
  const data = useRoleShortlist(ctx, roleId, roleTitle)
  const actions = useShortlistEntryActions(data.queryKey)
  const [chip, setChip] = useState<Chip>('all')
  const [sheet, setSheet] = useState(false)
  const [menuFor, setMenuFor] = useState<ShortlistEntry | null>(null)
  const [noteFor, setNoteFor] = useState<ShortlistEntry | null>(null)
  const [noteText, setNoteText] = useState('')
  useEffect(() => { setNoteText(noteFor?.note ?? '') }, [noteFor])
  const [inviteFor, setInviteFor] = useState<InviteSheetPlayer | null>(null)
  const rowIds = useMemo(() => data.rows.map((r) => r.id), [data.rows])
  const inviteStatuses = useClubInviteStatuses(rowIds)
  const allowance = useInviteAllowance()
  const limitReason = allowance.reached ? inviteLimitReason(allowance.limit) : null

  const parent = (location.state as { parent?: string } | null)?.parent ?? 'Opportunities'
  const levelUnknown = !!target && !!ownLeague && ownLeague.band === null
  const ranked = useMemo(() => rankScoutRows(data.rows, { byFit: !!target && !levelUnknown }), [data.rows, target, levelUnknown])
  const applied = ranked.filter((r) => r.shortlistedApp)
  const scouted = ranked.filter((r) => !r.shortlistedApp)
  const list = chip === 'applied' ? applied : chip === 'scouted' ? scouted : ranked
  const contexts = useMemo(() => playerContexts(scouting.contexts, new Set(openRoles.map((r) => r.id)), ctx?.id ?? null), [scouting.contexts, openRoles, ctx])
  const chips: { id: Chip; label: string }[] = [
    { id: 'all', label: `All · ${ranked.length}` },
    { id: 'applied', label: `Applied · ${applied.length}` },
    { id: 'scouted', label: `Scouted · ${scouted.length}` },
  ]
  const pick = (c: ContextLike | null) => {
    setSheet(false)
    if (c) void scouting.activate(c.id)
    else void scouting.clearActive()
  }

  const message = async (r: ShortlistEntry) => {
    if (!user) return
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .or(`and(participant_one_id.eq.${user.id},participant_two_id.eq.${r.id}),and(participant_one_id.eq.${r.id},participant_two_id.eq.${user.id})`)
      .maybeSingle()
    const state = { returnTo: location.pathname, from: location.pathname }
    if (conv?.id) navigate(`/messages?conversation=${conv.id}`, { state })
    else navigate(`/messages?new=${r.id}`, { state })
  }

  const saveNote = () => {
    if (!noteFor) return
    const t = noteText.trim()
    void actions.setNote(noteFor, t ? t.slice(0, NOTE_MAX) : null)
    setNoteFor(null)
  }

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="shortlist-screen">
      <DetailNavBar parent={parent} fallbackPath="/opportunities" />
      <div className="px-5 pb-3 pt-0.5">
        <h1 className="text-[30px] font-bold leading-9 tracking-[-0.36px] text-ink-1">Shortlist</h1>
        <p className="text-[14px] leading-[19px] text-ink-2">{shortlistHeaderLine(ranked.length)}</p>
      </div>

      <div className="flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Shortlist source">
        {chips.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={chip === c.id} onClick={() => setChip(c.id)} className={cn('shrink-0 rounded-full px-3.5 py-2 text-[14px] font-semibold', chip === c.id ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1')}>
            {c.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setSheet(true)} className="flex items-center gap-1 px-5 pb-1 pt-3.5 text-secondary text-ink-2" data-testid="shortlist-ranked-for">
        Ranked for {contextPillLabel(ctx)}
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      </button>

      {limitReason && list.length > 0 && <InviteLimitNotice reason={limitReason} />}
      {data.error && <p className="px-5 py-3 text-row text-ink-2">{data.error}</p>}
      {data.loading && <p className="px-5 py-4 text-row text-ink-3" aria-live="polite">Loading…</p>}
      {!data.loading && !data.error && list.length === 0 && (
        <div className="px-5 py-4">
          <p className="text-row text-ink-3">
            {chip === 'applied' ? 'No applicants shortlisted for this role yet.' : chip === 'scouted' ? 'No one scouted for this role yet.' : 'No one on this shortlist yet.'}
          </p>
          {chip !== 'applied' && (
            <button type="button" onClick={() => navigate('/dashboard/find-players')} className="mt-3 flex h-11 items-center rounded-full bg-surface-grouped px-4 text-row font-semibold text-ink-1">Find players</button>
          )}
        </div>
      )}

      <div>
        {list.map((r, i) => {
          const app = r.shortlistedApp
          const source = shortlistSourceLine({ applied: !!app, position: app?.position ?? null, shortlistedAt: app?.at ?? null, savedAt: r.savedAt })
          return (
            <div key={r.id}>
              <ScoutPlayerRow
                row={r}
                countries={countries}
                meta={{ kind: 'custom', text: source, icon: app ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" /> : <Star className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" /> }}
                below={r.note ? <span className="mt-2 block border-l-2 border-hockia-primary pl-2.5 text-[14px] leading-[19px] text-ink-1" data-testid="shortlist-note">{r.note}</span> : null}
                trailing={(
                  <span className="flex items-center gap-2">
                    <InviteAction
                      pill={app ? 'applied' : inviteStatuses.pillFor(r.id)}
                      invitable={isInvitablePlayer(r)}
                      name={r.full_name}
                      limitReason={limitReason}
                      onInvite={() => setInviteFor(r)}
                    />
                    <button type="button" onClick={() => void message(r)} aria-label={`Message ${r.full_name ?? 'player'}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-grouped text-ink-1">
                      <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} />
                    </button>
                  </span>
                )}
                onOpen={() => navigate(`/players/id/${r.id}`, { state: { from: location.pathname } })}
                onLongPress={() => setMenuFor(r)}
                testId="shortlist-row"
              />
              {i < list.length - 1 && <div className="ml-[84px] h-[0.5px] bg-line" />}
            </div>
          )
        })}
      </div>

      {!data.loading && (
        <div className="px-5 pt-5">
          <div className="flex items-start gap-2.5 rounded-card bg-surface-grouped p-3.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
            <p className="text-secondary leading-[18px] text-ink-2">Players are never told they’re on your shortlist. Notes are private to your club.</p>
          </div>
        </div>
      )}

      <BottomSheet open={!!menuFor} onClose={() => setMenuFor(null)} ariaLabel={menuFor?.full_name ?? 'Player'}>
        <div role="menu" className="pb-2">
          <p className="truncate px-5 pb-2 pt-1 text-secondary text-ink-2">{menuFor?.full_name}</p>
          {menuFor?.savedId && (
            <button type="button" role="menuitem" onClick={() => { setNoteFor(menuFor); setMenuFor(null) }} className="flex h-[52px] w-full items-center px-5 text-left text-[16px] text-ink-1">
              {menuFor.note ? 'Edit note' : 'Add note'}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => { if (menuFor) void actions.remove(menuFor); setMenuFor(null) }} className="flex h-[52px] w-full items-center px-5 text-left text-[16px] text-hockia-danger">
            {menuFor?.shortlistedApp ? 'Remove (moves the application to Maybe)' : 'Remove'}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={!!noteFor} onClose={() => setNoteFor(null)} ariaLabel="Note">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-[17px] font-semibold text-ink-1">Note on {noteFor?.full_name?.trim().split(/\s+/)[0] || 'this player'}</h2>
          <p className="pb-2 text-secondary text-ink-2">Only your club sees this.</p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value.slice(0, NOTE_MAX))}
            rows={4}
            aria-label="Note"
            className="w-full resize-none rounded-card bg-surface-grouped p-3 text-[16px] text-ink-1 outline-none focus:ring-2 focus:ring-hockia-primary"
          />
          <div className="flex gap-2.5 pt-3">
            {noteFor?.note && (
              <button type="button" onClick={() => { if (noteFor) void actions.setNote(noteFor, null); setNoteFor(null) }} className="flex h-[46px] flex-1 items-center justify-center rounded-full bg-surface-grouped text-[16px] font-semibold text-ink-1">Clear</button>
            )}
            <button type="button" onClick={saveNote} className="flex h-[46px] flex-1 items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white">Save note</button>
          </div>
        </div>
      </BottomSheet>

      {inviteFor && (
        <Suspense fallback={null}>
          <InviteSheet open={!!inviteFor} player={inviteFor} activeRoleId={roleId} onClose={() => setInviteFor(null)} />
        </Suspense>
      )}
      <RankedForSheet open={sheet} contexts={contexts} activeId={ctx?.id ?? null} roles={scouting.roles} onPick={pick} onClose={() => setSheet(false)} />
      <UndoToast />
    </div>
  )
}
