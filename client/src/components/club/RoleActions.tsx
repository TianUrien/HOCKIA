import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, RotateCcw, XCircle } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { closeRolePatch, closeRoleToast, reopenRolePatch, type RoleCloseOutcome } from '@/lib/roleLifecycle'

/**
 * The "…" menu on a club's own role (phone Club v2): Edit role, Close role
 * (asks Filled vs Not filled), Reopen role for a closed one. Same writes as
 * the desktop Opportunities tab (lib/roleLifecycle). Render it only for the
 * owning club — the update is also scoped to club_id, and RLS refuses others.
 */
export interface RoleActionsRole {
  id: string
  club_id: string
  status: string | null
  title: string
  application_deadline: string | null
}

interface Props {
  role: RoleActionsRole
  /** Called after a close / reopen lands, so the caller can reload. */
  onChanged: () => void
  /** Icon colour/size tweaks for the host (card vs nav bar). */
  className?: string
}

export function RoleActions({ role, onChanged, className }: Props) {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const [sheet, setSheet] = useState<null | 'menu' | 'close'>(null)
  const [busy, setBusy] = useState(false)
  const isOpen = role.status === 'open'
  const isClosed = role.status === 'closed'

  const close = async (outcome: RoleCloseOutcome) => {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('opportunities').update(closeRolePatch(outcome) as never).eq('id', role.id).eq('club_id', role.club_id)
      if (error) throw error
      setSheet(null)
      addToast(closeRoleToast(outcome), 'success')
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
      setSheet(null)
      addToast('Role reopened.', 'success')
      onChanged()
    } catch (err) {
      logger.error('[RoleActions] reopen failed', err)
      addToast('Could not reopen the role. Try again.', 'error')
    } finally {
      setBusy(false)
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
            <button type="button" className={item} onClick={() => { setSheet(null); navigate(`/dashboard/opportunities/${role.id}/edit`) }}>
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
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2" data-testid="close-role-sheet">
          <h2 className="text-[20px] font-bold text-ink-1">Close this role?</h2>
          <p className="mt-1 text-row text-ink-2">It stops taking applications. Applicants stay attached, and you can reopen it any time.</p>
          <p className="mt-3 text-row font-semibold text-ink-1">Did you fill it?</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <button type="button" disabled={busy} onClick={() => void close('filled')} className="flex h-[50px] items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-60">Filled</button>
            <button type="button" disabled={busy} onClick={() => void close('withdrawn')} className="flex h-[50px] items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1 disabled:opacity-60">Not filled / no longer needed</button>
            <button type="button" onClick={() => setSheet(null)} className="flex h-11 items-center justify-center text-body text-ink-2">Cancel</button>
          </div>
        </div>
      </BottomSheet>
    </>
  )
}
