import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { SwitchCardRow } from '@/components/ui/SwitchCardRow'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { useRecruitingContextStore } from '@/hooks/useRecruitingContext'
import { closeRolePatch, closeRoleToast, closeRoleToldToast, type RoleCloseOutcome } from '@/lib/roleLifecycle'
import { countWaitingApplicants, fetchTellableApplicants, tellWaitingApplicants, type WaitingApplicant } from '@/lib/roleWaiting'
import { DECLINE_BODY_MAX, declineGreeting, declineNoteBody, personalDeclineNote } from '@/lib/declineNotes'
import { roleTitle } from '@/lib/opportunityCopy'
import { cn } from '@/lib/utils'

/**
 * Close a role (Figma 05 Club speed · CS6 204:1269): Filled or Not filled,
 * and — on by default — tell everyone still waiting with one note (fixed
 * template, founder ruling 2026-10-17), each with their own first name.
 * Shared by the phone role menu (RoleActions) and the dashboard's
 * Opportunities tab, so a close works the same everywhere.
 */
export interface CloseRoleTarget {
  id: string
  club_id: string
  title: string
  position?: string | null
  opportunity_type?: string | null
}

interface Props {
  open: boolean
  role: CloseRoleTarget
  onCancel: () => void
  /** After the close landed (toast already shown). */
  onClosed: (outcome: RoleCloseOutcome) => void
}

export function CloseRoleSheet({ open, role, onCancel, onClosed }: Props) {
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)
  // The same title the applicants list and the player see (position for a player role).
  const shownTitle = roleTitle({ position: role.position ?? null, title: role.title, opportunity_type: role.opportunity_type ?? null })
  const [outcome, setOutcome] = useState<RoleCloseOutcome | null>(null)
  const [waiting, setWaiting] = useState<WaitingApplicant[]>([])
  const [tell, setTell] = useState(true)
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState(false)

  useEffect(() => {
    if (!open) { setOutcome(null); setTell(true); setBody(''); setEdited(false); return }
    let cancelled = false
    void fetchTellableApplicants(role.id).then((rows) => { if (!cancelled) setWaiting(rows) })
    return () => { cancelled = true }
  }, [open, role.id])

  const pickOutcome = (o: RoleCloseOutcome) => {
    setOutcome(o)
    if (!edited) setBody(declineNoteBody(o === 'filled' ? 'position_filled' : 'role_closed', shownTitle))
  }
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
      addToast(told && (told.told || told.failed) ? closeRoleToldToast(told.told, told.failed) : closeRoleToast(chosen, left), 'success')
      onClosed(chosen)
    } catch (err) {
      logger.error('[CloseRoleSheet] close failed', err)
      addToast('Could not close the role. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }


  return (
      <BottomSheet open={open} onClose={onCancel} ariaLabel="Close this role">
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
          <button type="button" onClick={onCancel} className="-mt-1.5 flex h-11 items-center justify-center text-body text-ink-2">Cancel</button>
        </div>
      </BottomSheet>
  )
}
