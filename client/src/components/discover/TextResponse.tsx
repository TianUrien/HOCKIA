import type { SuggestedAction } from '@/hooks/useDiscover'
import ActionChipRow from './ActionChipRow'

interface TextResponseProps {
  message: string
  suggestedActions?: SuggestedAction[]
  onAction: (action: SuggestedAction) => void
}

/**
 * Plain, left-aligned assistant text + the chip row underneath (Figma
 * 44:321 / 524:1715 can't answer). Used for greetings, self-advice,
 * knowledge answers and any message without a kind. The chip-or-no-chip
 * decision is made by the caller; this component renders what it is given.
 */
export default function TextResponse({ message, suggestedActions, onAction }: TextResponseProps) {
  return (
    <div>
      <p className="text-row text-ink-1 whitespace-pre-line">{message}</p>
      {suggestedActions && suggestedActions.length > 0 && (
        <ActionChipRow actions={suggestedActions} onAction={onAction} />
      )}
    </div>
  )
}
