import { Briefcase, Check, ChevronRight } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { FitCard } from '@/components/club/FitCard'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { fitRows } from '@/lib/clubRecruiting'
import { appliedLine } from '@/lib/profileD2'
import type { ClubRole, ClubViewApplication, ClubViewFit } from '@/hooks/useClubViewOfPlayer'

/**
 * Club-only cards on a player's profile (Figma D2.1 club view 395:83):
 * "Applied to …" (395:167) and "Fit for this role" (395:178), plus the role
 * picker the Shortlist button opens when the club has several open roles.
 * Never rendered for players (the parent gates on isRecruitingViewer).
 */
export function AppliedToCard({ application, onOpen }: { application: ClubViewApplication; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl bg-surface-grouped p-3.5 text-left" data-testid="applied-to-card">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-hockia-soft text-hockia-primary">
        <Briefcase className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-row font-semibold text-ink-1">Applied to {application.role.title}</span>
        <span className="block text-secondary text-ink-2">{appliedLine(application)}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />
    </button>
  )
}

export function FitForRoleCard({ fit, role, player, pronoun }: {
  fit: ClubViewFit
  role: ClubRole
  player: { playing_category?: string | null; last_active_at?: string | null; current_club?: string | null; full_name?: string | null }
  pronoun: 'his' | 'her' | 'their'
}) {
  // Grey fit → no card (founder ruling: hidden when fit is grey).
  if (fit.state === 'grey') return null
  const lastDays = player.last_active_at ? Math.max(0, Math.floor((Date.now() - new Date(player.last_active_at).getTime()) / 86_400_000)) : null
  const rows = fitRows(fit.components, {
    roleGender: role.gender,
    playerCategoryLabel: categoryToDisplay(player.playing_category ?? null) || null,
    firstName: player.full_name?.trim().split(/\s+/)[0] || 'this player',
    pronoun,
    lastActiveDays: lastDays,
    playerClub: player.current_club?.trim() || null,
    playerLeagueKnown: fit.playerLeagueBanded,
    clubLeagueKnown: fit.clubLeagueBanded,
  })
  return <FitCard state={fit.state} rows={rows} />
}

export function ShortlistRoleSheet({ open, roles, shortlistedRoleIds, appliedRoleId, onPick, onClose }: {
  open: boolean
  roles: ClubRole[]
  shortlistedRoleIds: string[]
  appliedRoleId: string | null
  onPick: (role: ClubRole) => void
  onClose: () => void
}) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Shortlist for a role">
      <div className="px-5 pb-3 pt-1">
        <h2 className="text-title text-ink-1">Shortlist for which role?</h2>
        <p className="mt-1 text-secondary text-ink-2">Each role keeps its own shortlist.</p>
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped" role="list">
          {roles.map((r) => {
            const done = shortlistedRoleIds.includes(r.id)
            return (
              <button key={r.id} type="button" role="listitem" disabled={done} onClick={() => onPick(r)} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left disabled:opacity-60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink-1">{r.title}</span>
                  {appliedRoleId === r.id && <span className="block text-secondary text-ink-2">Applied to this role</span>}
                </span>
                {done && <Check className="h-5 w-5 text-hockia-primary" strokeWidth={2.4} />}
              </button>
            )
          })}
        </div>
      </div>
    </BottomSheet>
  )
}
