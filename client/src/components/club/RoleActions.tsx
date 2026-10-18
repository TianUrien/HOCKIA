import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, RotateCcw, Search, XCircle } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { useFindForRole } from '@/hooks/useFindForRole'
import { useRecruitingContextStore } from '@/hooks/useRecruitingContext'
import { closeRolePatch, closeRoleToast, closeRoleToldToast, REOPEN_ROLE_TOAST, reopenRolePatch, type RoleCloseOutcome } from '@/lib/roleLifecycle'
import { countWaitingApplicants, fetchTellableApplicants, tellWaitingApplicants, type WaitingApplicant } from '@/lib/roleWaiting'
import { DECLINE_BODY_MAX, declineGreeting, declineNoteBody, personalDeclineNote } from '@/lib/declineNotes'
import { SwitchCardRow } from '@/components/ui/SwitchCardRow'
import { cn } from '@/lib/utils'
import { roleTitle } from '@/lib/opportunityCopy'

/**
 * The "…" menu on a club's own role (phone Club v2): Edit role, Close role
 * (asks Filled vs Not filled), Reopen role for a closed one, and — on an open
 * role — Find players / Find coaches for this role (activates the role's
 * recruiting context first, like Role posted). Same writes as
 * the desktop Opportunities tab (lib/roleLifecycle). Render it only for the
 * owning club — the update is also scoped to club_id, and RLS refuses others.
 */
export interface RoleActionsRole {
  id: string
  club_id: string
  status: string | null
  title: string
  application_deadline: string | null
  /** For "Find … for this role" (open roles only). */
  opportunity_type?: string | null
  /** For the role's display title in the close sheet (player roles read by position). */
  position?: string | null
  gender?: string | null
  location_city?: string | null
}

interface Props {
  role: RoleActionsRole
  /** Called after a close / reopen lands, so the caller can reload. */
  onChanged: () => void
  /** Icon colour/size tweaks for the host (card vs nav bar). */
  className?: string
  /** Where "Edit role" goes. Default: the club's phone editor. A coach who
   *  recruits edits in their own role form (Coach v2 · My roles). */
  onEdit?: () => void
}

export function RoleActions({ role, onChanged, className, onEdit }: Props) {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const [sheet, setSheet] = useState<null | 'menu' | 'close'>(null)
  const [busy, setBusy] = useState(false)
  const { findForRole, finding } = useFindForRole()
  const isOpen = role.status === 'open'
  const isClosed = role.status === 'closed'
  // Club speed CS6 (Figma 05 204:1269): Filled or Not filled, and — on by
  // default — tell everyone still waiting with one note (fixed template,
  // founder ruling 2026-10-17), each with their own first name.
  const [outcome, setOutcome] = useState<RoleCloseOutcome | null>(null)
  const [waiting, setWaiting] = useState<WaitingApplicant[]>([])
  const [tell, setTell] = useState(true)
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState(false)

  useEffect(() => {
    if (sheet !== 'close') { setOutcome(null); setTell(true); setBody(''); setEdited(false); return }
    let cancelled = false
    void fetchTellableApplicants(role.id).then((rows) => { if (!cancelled) setWaiting(rows) })
    return () => { cancelled = true }
  }, [sheet, role.id])

  const pickOutcome = (o: RoleCloseOutcome) => {
    setOutcome(o)
    if (!edited) setBody(declineNoteBody(o === 'filled' ? 'position_filled' : 'role_closed', shownTitle))
  }
  // The same title the applicants list and the player see (position for a player role).
  const shownTitle = roleTitle({ position: role.position ?? null, title: role.title, opportunity_type: role.opportunity_type ?? null })
  const telling = tell && waiting.length > 0
  const players = (n: number) => (n === 1 ? '1 player' : `${n} players`)

  const close = async (chosen: RoleCloseOutcome) => {
    if (busy) return
    if (telling && (!body.trim() || body.length > DECLINE_BODY_MAX)) return
    setBusy(true)
    try {
      // Tell first, so the players hear from the club before the role closes.
      const told = telling
        ? await tellWaitingApplicants(waiting, chosen === 'filled' ? 'position_filled' : 'other', (first) => personalDeclineNote(first, body))
        : null
      const left = chosen === 'filled' ? await countWaitingApplicants(role.id) : 0
      const { error } = await supabase.from('opportunities').update(closeRolePatch(chosen) as never).eq('id', role.id).eq('club_id', role.club_id)
      if (error) throw error
      // A closed role never stays the active "Ranked for" context.
      void useRecruitingContextStore.getState().roleStatusChanged(role.id, 'closed')
      setSheet(null)
      addToast(told && (told.told || told.failed) ? closeRoleToldToast(told.told, told.failed) : closeRoleToast(chosen, left), 'success')
      onChanged()
    } catch (err) {
      logger.error('[RoleActions] close failed', err)
      addToast('Could not close the role. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const reopen = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('opportunities').update(reopenRolePatch(role.application_deadline) as never).eq('id', role.id).eq('club_id', role.club_id)
      if (error) throw error
      void useRecruitingContextStore.getState().roleStatusChanged(role.id, 'open')
      setSheet(null)
      addToast(REOPEN_ROLE_TOAST, 'success')
      onChanged()
    } catch (err) {
      logger.error('[RoleActions] reopen failed', err)
      addToast('Could not reopen the role. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const isPlayerRole = role.opportunity_type !== 'coach'
  const find = async () => {
    if (finding) return
    try {
      const to = await findForRole({ id: role.id, type: isPlayerRole ? 'player' : 'coach', title: role.title, gender: role.gender ?? null, city: role.location_city ?? null })
      setSheet(null)
      navigate(to)
    } catch (err) {
      logger.error('[RoleActions] find for role failed', err)
      addToast('Could not open the search. Try again.', 'error')
    }
  }

  const item = 'flex h-[52px] w-full items-center gap-3 px-4 text-left text-body text-ink-1 disabled:opacity-50'

  return (
    <>
      <button
        type="button"
        onClick={() => setSheet('menu')}
        aria-label={`More actions for ${role.title}`}
        aria-haspopup="dialog"
        className={className ?? '-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2'}
        data-testid="role-actions-button"
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
      </button>

      <BottomSheet open={sheet === 'menu'} onClose={() => setSheet(null)} ariaLabel="Role actions">
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1" data-testid="role-actions-sheet">
          <p className="truncate pb-3 text-center text-secondary font-semibold text-ink-2">{role.title}</p>
          <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            {isOpen && (
              <button type="button" className={item} disabled={finding} onClick={() => void find()} data-testid="role-actions-find">
                <Search className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> {isPlayerRole ? 'Find players for this role' : 'Find coaches for this role'}
              </button>
            )}
            <button type="button" className={item} onClick={() => { setSheet(null); if (onEdit) onEdit(); else navigate(`/dashboard/opportunities/${role.id}/edit`) }}>
              <Pencil className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> Edit role
            </button>
            {isOpen && (
              <button type="button" className={item} onClick={() => setSheet('close')}>
                <XCircle className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> Close role
              </button>
            )}
            {isClosed && (
              <button type="button" className={item} disabled={busy} onClick={() => void reopen()}>
                <RotateCcw className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> Reopen role
              </button>
            )}
          </div>
          <button type="button" onClick={() => setSheet(null)} className="mt-2.5 flex h-11 w-full items-center justify-center text-body text-ink-2">Cancel</button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'close'} onClose={() => setSheet(null)} ariaLabel="Close this role">
        <div className="flex flex-col gap-3.5 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2" data-testid="close-role-sheet">
          <h2 className="text-[22px] font-bold leading-[27px] tracking-[-0.13px] text-ink-1">Close {shownTitle}?</h2>
          <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Did you fill it?">
            {([['filled', 'Filled', 'We found someone'], ['withdrawn', 'Not filled', 'No longer needed']] as const).map(([value, title, sub]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={outcome === value}
                onClick={() => pickOutcome(value)}
                className="flex items-center gap-3 rounded-[16px] bg-surface-subtle px-4 py-3 text-left"
                data-testid={`close-role-${value}`}
              >
                <span aria-hidden="true" className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', outcome === value ? 'bg-brand-primary' : 'border-2 border-ink-4')}>
                  {outcome === value && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] leading-[22px] text-ink-1">{title}</span>
                  <span className="block text-secondary text-ink-2">{sub}</span>
                </span>
              </button>
            ))}
          </div>
          {waiting.length > 0 && (
            <SwitchCardRow
              title={`Tell the ${waiting.length === 1 ? 'player' : `${waiting.length} players`} still waiting`}
              description={tell ? 'They see “Not selected” with this note' : outcome === 'filled' ? 'They’ll still see the role was filled' : 'They’ll hear when their application closes'}
              checked={tell}
              onChange={() => setTell((v) => !v)}
              testId="close-role-tell"
            />
          )}
          {telling && outcome && (
            <div className="flex flex-col gap-2.5 rounded-[16px] bg-surface-subtle px-4 py-3.5 focus-within:ring-2 focus-within:ring-focus-ring" data-testid="close-role-note">
              <div className="text-body text-ink-1">
                <p>{declineGreeting(waiting[0]?.firstName)}</p>
                <textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setEdited(true) }}
                  rows={Math.max(4, Math.ceil(body.length / 38))}
                  maxLength={DECLINE_BODY_MAX}
                  aria-label="Note to each player"
                  className="block w-full resize-none bg-transparent text-body text-ink-1 outline-none focus-visible:outline-none"
                />
              </div>
              {waiting.length > 1 && waiting[0]?.firstName && (
                <span className="self-start rounded-full bg-surface-muted px-2 py-[3px] text-caption text-ink-2">Preview for {waiting[0].firstName}</span>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={busy || !outcome || (telling && !body.trim())}
            onClick={() => outcome && void close(outcome)}
            className="flex h-[52px] items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40"
            data-testid="close-role-confirm"
          >
            {busy ? 'Closing…' : telling ? `Close role and tell ${players(waiting.length)}` : 'Close role'}
          </button>
          <button type="button" onClick={() => setSheet(null)} className="-mt-1.5 flex h-11 items-center justify-center text-body text-ink-2">Cancel</button>
        </div>
      </BottomSheet>
    </>
  )
}
