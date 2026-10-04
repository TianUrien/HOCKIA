import type { SuggestedAction } from '@/hooks/useDiscover'
import { Chip } from '@/components/ui/Chip'

interface ActionChipRowProps {
  actions: SuggestedAction[]
  onAction: (action: SuggestedAction) => void
  /** Kept for callers; both layouts wrap, the spacing is the only difference. */
  compact?: boolean
}

/**
 * Follow-up suggestions under a Hockia AI answer: standard Chips (grey pill,
 * unselected), tap sends / navigates. Labels come from the backend catalog or
 * lib/hockiaAi.ts; the row renders whatever it is given.
 */
export default function ActionChipRow({ actions, onAction, compact = false }: ActionChipRowProps) {
  if (!actions || actions.length === 0) return null

  return (
    <div
      className={compact ? 'mt-2 flex flex-wrap gap-2' : 'mt-3 flex flex-wrap gap-2'}
      role="group"
      aria-label="Suggested next actions"
    >
      {actions.map((action, idx) => (
        <Chip
          key={`${action.label}-${idx}`}
          label={action.label}
          onClick={() => onAction(action)}
          data-testid="ai-chip"
        />
      ))}
    </div>
  )
}
