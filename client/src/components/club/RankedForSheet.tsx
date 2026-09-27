import { lazy, Suspense, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { positionLabel } from '@/lib/identity'
import { contextPillLabel, type ContextLike } from '@/lib/findPlayers'
import { cn } from '@/lib/utils'
import type { ContextKind } from '@/lib/newContext'

// Own chunk: the Post a role form pieces load only when "New context" is tapped.
const NewContextSheet = lazy(() => import('./NewContextSheet'))

/**
 * Recruiting for (Figma 04 Club D1.23 355:528; DEV NOTE 355:931) — opened
 * by the "Ranked for" pill. Open roles (one context each) and saved
 * contexts, plus "No context". Picking one makes it active and re-ranks
 * Find players; the Shortlist follows the same role. "New context" opens
 * the short criteria form (Post a role step 1) and saves a custom context,
 * which becomes the active one.
 */
interface Props {
  open: boolean
  contexts: ContextLike[]
  activeId: string | null
  /** Role titles and "to review" counts, by opportunity id. */
  roles: Map<string, { title: string; toReview: number }>
  onPick: (ctx: ContextLike | null) => void
  onClose: () => void
  /** Which people this screen ranks; a new context is of this kind. */
  kind?: ContextKind
}

export function RankedForSheet({ open, contexts, activeId, roles, onPick, onClose, kind = 'player' }: Props) {
  const [creating, setCreating] = useState(false)
  // Closed from outside while the form was up: the next open starts on the list.
  if (!open && creating) setCreating(false)
  const first = (a: ContextLike, b: ContextLike) => Number(b.id === activeId) - Number(a.id === activeId)
  const roleContexts = contexts.filter((c) => c.type === 'opportunity').sort(first)
  const saved = contexts.filter((c) => c.type !== 'opportunity').sort(first)
  const option = (key: string, title: string, detail: string, selected: boolean, pick: () => void) => (
    <button key={key} type="button" role="radio" aria-checked={selected} onClick={pick} className="flex min-h-[64px] w-full items-center gap-3 rounded-card bg-surface-grouped px-4 py-3 text-left">
      <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-hockia-primary bg-hockia-primary' : 'border-ink-4 bg-white')} aria-hidden="true">
        {selected && <svg viewBox="0 0 12 12" className="h-3 w-3 text-white"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] leading-[22px] text-ink-1">{title}</span>
        <span className="block truncate text-secondary text-ink-2">{detail}</span>
      </span>
    </button>
  )
  const roleTitle = (c: ContextLike) => {
    const r = c.opportunity_id ? roles.get(c.opportunity_id) : undefined
    const pos = c.target_position ? positionLabel(c.target_position) : null
    const title = r?.title ?? c.label ?? null
    return [pos, title].filter(Boolean).join(' · ') || contextPillLabel(c)
  }
  const roleDetail = (c: ContextLike) => {
    const n = c.opportunity_id ? roles.get(c.opportunity_id)?.toReview ?? 0 : 0
    return n > 0 ? `From your open role · ${n} to review` : 'From your open role'
  }
  return (
    <>
    <BottomSheet open={open && !creating} onClose={onClose} ariaLabel="Recruiting for">
      <div className="relative px-5 pb-2 pt-1">
        <h2 className="pr-10 text-[22px] font-bold leading-7 text-ink-1">Recruiting for</h2>
        <p className="text-[14px] leading-[19px] text-ink-2">Ranks people and applicants for you. Only you see this.</p>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-0 flex h-10 w-10 items-center justify-center text-ink-3">
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
      <div role="radiogroup" aria-label="Recruiting for" className="flex flex-col gap-2 px-5 pb-4">
        {roleContexts.length > 0 && <p className="pt-2 text-caption font-semibold uppercase tracking-[0.4px] text-ink-2">Your open roles</p>}
        {roleContexts.map((c) => option(c.id, roleTitle(c), roleDetail(c), c.id === activeId, () => onPick(c)))}
        <p className="pt-3 text-caption font-semibold uppercase tracking-[0.4px] text-ink-2">Saved contexts</p>
        {saved.map((c) => option(c.id, contextPillLabel(c), 'Saved context', c.id === activeId, () => onPick(c)))}
        {option('none', 'No context', 'Rank by evidence and recent activity', activeId === null, () => onPick(null))}
        <button type="button" onClick={() => setCreating(true)} className="mt-2 flex h-[50px] w-full items-center justify-center gap-1.5 rounded-full bg-surface-grouped text-body font-semibold text-ink-1" data-testid="new-context-button">
          <Plus className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          New context
        </button>
      </div>
    </BottomSheet>
    {open && creating && (
      <Suspense fallback={null}>
        <NewContextSheet open kind={kind} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); onClose() }} />
      </Suspense>
    )}
    </>
  )
}
