import { useMemo, useState } from 'react'
import { RankedForSheet } from '@/components/club/RankedForSheet'
import { RankedForPill } from '@/components/club/RankedForPill'
import { useScoutingContext } from '@/hooks/useScouting'
import { contextKind } from '@/hooks/useRecruitingContext'
import { contextPillLabel, playerContexts, type ContextLike } from '@/lib/findPlayers'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { useAuthStore } from '@/lib/auth'

/**
 * "Ranked for" pill + sheet wired to the recruiting-context store — the one
 * context UI (unify ruling 16 Oct 2026; replaces ContextSwitcher,
 * ContextEditSheet and CoachContextNudge). `kind` = which people the screen
 * ranks: player screens list open player roles + saved player searches,
 * the Coaches tab lists coach ones (round-6 kind rules). Recruiters only.
 */
export function RankedForControl({ kind = 'player', className }: { kind?: 'player' | 'coach'; className?: string }) {
  const viewer = useAuthStore((s) => s.profile)
  const scouting = useScoutingContext()
  // Same store as everywhere (useScoutingContext reads useRecruitingContext).
  const { ctx, contexts: available, activate, clearActive } = scouting
  const [open, setOpen] = useState(false)

  const contexts = useMemo(() => {
    const rows = available as (ContextLike & { opportunity_status?: string | null })[]
    if (kind === 'player') return playerContexts(rows, new Set(scouting.openRoles.map((r) => r.id)), ctx?.id ?? null)
    return rows.filter((r) => contextKind(r) === 'coach' && (r.type !== 'opportunity' || r.opportunity_status === 'open' || r.id === ctx?.id))
  }, [kind, available, scouting.openRoles, ctx])

  const roles = useMemo(() => {
    if (kind === 'player') return scouting.roles
    const m = new Map<string, { title: string; toReview: number }>()
    for (const c of contexts) if (c.opportunity_id) m.set(c.opportunity_id, { title: c.label ?? 'Coaching role', toReview: 0 })
    return m
  }, [kind, scouting.roles, contexts])

  if (!isRecruitingViewer(viewer)) return null
  const pick = (c: ContextLike | null) => {
    setOpen(false)
    if (c) void activate(c.id)
    else void clearActive()
  }
  return (
    <>
      <RankedForPill label={contextPillLabel(ctx)} onClick={() => setOpen(true)} className={className} />
      <RankedForSheet open={open} contexts={contexts} activeId={ctx?.id ?? null} roles={roles} onPick={pick} onClose={() => setOpen(false)} kind={kind} />
    </>
  )
}
