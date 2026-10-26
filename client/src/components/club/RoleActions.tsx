import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, RotateCcw, Search, XCircle } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { useFindForRole } from '@/hooks/useFindForRole'
import { useRecruitingContextStore } from '@/hooks/useRecruitingContext'
import { REOPEN_ROLE_TOAST, reopenRolePatch } from '@/lib/roleLifecycle'
import { CloseRoleSheet } from './CloseRoleSheet'
import { roleTitle } from '@/lib/opportunityCopy'
import { useAuthStore } from '@/lib/auth'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { shortDayOf } from '@/lib/signing'
import { closedRoleLine } from '@/lib/postAgain'
import { ChevronRight } from 'lucide-react'

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
  /** For the closed role's line ("Closed 12 Sep · not filled"). */
  closed_at?: string | null
  closed_reason?: string | null
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
  /** Club speed CS3 · Post again from a closed role. Default (a club on its
   *  phone): Post a role opens on the check screen with the same details.
   *  Desktop and coach hosts pass their own (the create form, prefilled). */
  onPostAgain?: () => void
}

export function RoleActions({ role, onChanged, className, onEdit, onPostAgain }: Props) {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const [sheet, setSheet] = useState<null | 'menu' | 'close'>(null)
  const [busy, setBusy] = useState(false)
  const { findForRole, finding } = useFindForRole()
  const isOpen = role.status === 'open'
  const isClosed = role.status === 'closed'
  const viewerRole = useAuthStore((st) => st.profile?.role)
  const phone = useMediaQuery('(max-width: 1023px)')
  const postAgain = onPostAgain ?? (viewerRole === 'club' && phone ? () => navigate('/dashboard/opportunities/new', { state: { postAgainId: role.id } }) : null)
  const closedLine = closedRoleLine(role.closed_at, role.closed_reason, (iso) => shortDayOf(iso))
  // The same title the applicants list and the player see (position for a player role).
  const shownTitle = roleTitle({ position: role.position ?? null, title: role.title, opportunity_type: role.opportunity_type ?? null })

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
      addToast('Could not reopen the opportunity. Try again.', 'error')
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

      <BottomSheet open={sheet === 'menu' && isClosed} onClose={() => setSheet(null)} ariaLabel="Closed opportunity actions">
        {/* Figma 05 CS3 205:5722: Post again leads; Reopen keeps today's +30 days; Edit keeps it closed. */}
        <div className="flex flex-col gap-3 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1" data-testid="closed-role-actions">
          <div>
            <h2 className="text-[22px] font-bold leading-[27px] tracking-[-0.13px] text-ink-1">{shownTitle}</h2>
            <p className="mt-1 text-secondary text-ink-2">{closedLine}</p>
          </div>
          {postAgain && (
          <button type="button" onClick={() => { setSheet(null); postAgain() }} className="flex items-center gap-3 rounded-[16px] bg-brand-soft px-4 py-3 text-left disabled:opacity-50" data-testid="role-actions-post-again">
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] leading-[22px] text-brand-primary">Post again</span>
              <span className="block text-secondary text-ink-2">A new opportunity with the same details. Dates and applicants start fresh. You check it before it goes live.</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
          </button>
          )}
          <button type="button" disabled={busy} onClick={() => void reopen()} className="flex items-center gap-3 rounded-[16px] bg-surface-subtle px-4 py-3 text-left disabled:opacity-50" data-testid="role-actions-reopen">
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] leading-[22px] text-ink-1">Reopen this opportunity</span>
              <span className="block text-secondary text-ink-2">Same opportunity and applicants, open again for 30 days</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => { setSheet(null); if (onEdit) onEdit(); else navigate(`/dashboard/opportunities/${role.id}/edit`) }} className="flex items-center gap-3 rounded-[16px] bg-surface-subtle px-4 py-3 text-left disabled:opacity-50">
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] leading-[22px] text-ink-1">Edit opportunity</span>
              <span className="block text-secondary text-ink-2">Change the details; it stays closed</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setSheet(null)} className="flex h-11 w-full items-center justify-center text-body text-ink-2">Cancel</button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'menu' && !isClosed} onClose={() => setSheet(null)} ariaLabel="Opportunity actions">
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1" data-testid="role-actions-sheet">
          <p className="truncate pb-3 text-center text-secondary font-semibold text-ink-2">{role.title}</p>
          <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            {isOpen && (
              <button type="button" className={item} disabled={finding} onClick={() => void find()} data-testid="role-actions-find">
                <Search className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> {isPlayerRole ? 'Find players for this opportunity' : 'Find coaches for this opportunity'}
              </button>
            )}
            <button type="button" className={item} onClick={() => { setSheet(null); if (onEdit) onEdit(); else navigate(`/dashboard/opportunities/${role.id}/edit`) }}>
              <Pencil className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> Edit opportunity
            </button>
            {isOpen && (
              <button type="button" className={item} onClick={() => setSheet('close')}>
                <XCircle className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> Close opportunity
              </button>
            )}
            {isClosed && (
              <button type="button" className={item} disabled={busy} onClick={() => void reopen()}>
                <RotateCcw className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.8} /> Reopen opportunity
              </button>
            )}
          </div>
          <button type="button" onClick={() => setSheet(null)} className="mt-2.5 flex h-11 w-full items-center justify-center text-body text-ink-2">Cancel</button>
        </div>
      </BottomSheet>

      <CloseRoleSheet open={sheet === 'close'} role={role} onCancel={() => setSheet(null)} onClosed={() => { setSheet(null); onChanged() }} />
    </>
  )
}
