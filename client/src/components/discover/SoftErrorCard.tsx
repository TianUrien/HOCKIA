import { AlertTriangle, Info } from 'lucide-react'
import type { SuggestedAction } from '@/hooks/useDiscover'
import { SOFT_ERROR_DEFAULT_COPY } from '@/lib/hockiaAi'
import { cn } from '@/lib/utils'
import ActionChipRow from './ActionChipRow'

interface SoftErrorCardProps {
  /** Optional backend-provided message; a calm default is used if absent. */
  message?: string
  suggestedActions: SuggestedAction[]
  onAction: (action: SuggestedAction) => void
  /**
   * Neutral by default (surface-muted, ink text, info icon). `warning` is
   * amber and reserved for "the viewer must act" (founder rule 2026-09-26);
   * no Hockia AI state uses it today.
   */
  tone?: 'neutral' | 'warning'
  className?: string
}

/**
 * Calm notice used for transient failures, the daily cap and any backend
 * soft error. The recovery chips sit BELOW the card (Figma 524:1785), never
 * inside it, so the card reads as a note and the chips as the way forward.
 */
export default function SoftErrorCard({
  message,
  suggestedActions,
  onAction,
  tone = 'neutral',
  className,
}: SoftErrorCardProps) {
  const Icon = tone === 'warning' ? AlertTriangle : Info
  return (
    <div className={className}>
      <div
        data-testid="ai-notice-card"
        data-tone={tone}
        className={cn(
          'rounded-[16px] px-4 py-3.5',
          tone === 'warning' ? 'bg-status-warning-soft' : 'bg-surface-muted',
        )}
      >
        <div className="flex items-start gap-2">
          <Icon
            className={cn('mt-[3px] h-4 w-4 shrink-0', tone === 'warning' ? 'text-status-warning' : 'text-ink-3')}
            aria-hidden="true"
          />
          <p className="text-row text-ink-1 whitespace-pre-line">{message ?? SOFT_ERROR_DEFAULT_COPY}</p>
        </div>
      </div>
      <ActionChipRow actions={suggestedActions} onAction={onAction} />
    </div>
  )
}
