import type { ClarifyingOption } from '@/hooks/useDiscover'
import { Chip } from '@/components/ui/Chip'

interface ClarifyingQuestionCardProps {
  question: string
  options: ClarifyingOption[]
  onPick: (option: ClarifyingOption) => void
}

/**
 * Clarifying question: the question as plain answer text + 2-4 Chips.
 * Tapping a chip submits its routed_query as a new user message.
 */
export default function ClarifyingQuestionCard({
  question,
  options,
  onPick,
}: ClarifyingQuestionCardProps) {
  return (
    <div>
      <p className="text-row font-medium text-ink-1 whitespace-pre-line">{question}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Disambiguation options">
        {options.map((option, idx) => (
          <Chip key={`${option.label}-${idx}`} label={option.label} onClick={() => onPick(option)} />
        ))}
      </div>
    </div>
  )
}
