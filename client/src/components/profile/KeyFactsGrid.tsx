import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { KeyFact, KeyFactAction } from '@/lib/keyFacts'
import { formatDay } from '@/lib/keyFacts'
import { keyFactActionLabel } from '@/lib/profileD2'
import { workPermitTypeLabel } from '@/lib/workPermits'
import { cn } from '@/lib/utils'

/**
 * The six key facts under the name (Figma D2.1 club view 395:308 · D2.2 owner
 * 395:533): a two-column grid of grouped tiles — label, value, a detail line,
 * extra lines (visa / permit on the passport tile) and, for the owner, the Add
 * action that opens the matching editor. Content comes from lib/keyFacts.
 */
interface KeyFactsGridProps {
  facts: KeyFact[]
  onAction?: (action: KeyFactAction) => void
  className?: string
}

export function KeyFactsGrid({ facts, onAction, className }: KeyFactsGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)} data-testid="key-facts">
      {facts.map((f) => {
        const action = keyFactActionLabel(f)
        return (
          <div key={f.id} className="flex min-w-0 flex-col gap-0.5 rounded-card bg-surface-grouped p-3" data-testid={`key-fact-${f.id}`}>
            <span className="text-micro font-semibold uppercase tracking-[0.04em] text-ink-2">{f.label}</span>
            <span className={cn('break-words text-row font-semibold', f.missing ? 'text-ink-3' : 'text-ink-1')}>{f.value}</span>
            {f.detail && <span className="text-caption text-ink-2">{f.detail}</span>}
            {f.extraLines.map((line) => {
              const amber = line.status === 'expiring_soon' || line.status === 'expired'
              return (
                <span key={line.text} className={cn('text-caption', amber ? 'font-semibold text-amber-600' : 'text-ink-2')}>{line.text}</span>
              )
            })}
            {action && onAction && f.action && (
              <button type="button" onClick={() => onAction(f.action as KeyFactAction)} className="self-start text-secondary font-semibold text-hockia-primary">
                {action}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export interface AttentionPermit {
  id: string
  type: string
  expires_on: string | null
  status: string
  countryName: string
  flag: string | null
}

/**
 * Amber row — a visa / permit expiring within 30 days or already expired.
 * Owner's profile and the Passports & permits screen only; no email or push
 * (founder ruling 2026-09-26).
 */
export function PermitAttentionRow({ permit, onClick }: { permit: AttentionPermit; onClick?: () => void }) {
  const what = `${permit.flag ? `${permit.flag} ` : ''}${permit.countryName} ${workPermitTypeLabel(permit.type).toLowerCase()}`
  const day = formatDay(permit.expires_on)
  const text = permit.status === 'expired'
    ? `Your ${what} expired${day ? ` on ${day}` : ''}. Clubs no longer see it.`
    : `Your ${what} expires${day ? ` on ${day}` : ' soon'}. Update it so clubs keep seeing it.`
  const body = (
    <>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2.2} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-secondary text-ink-1">{text}</span>
      {onClick && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} aria-hidden="true" />}
    </>
  )
  const cls = 'flex w-full items-start gap-2.5 rounded-card bg-amber-50 px-3.5 py-3 text-left'
  return onClick
    ? <button type="button" onClick={onClick} className={cls} data-testid="permit-attention">{body}</button>
    : <div className={cls} data-testid="permit-attention">{body}</div>
}
