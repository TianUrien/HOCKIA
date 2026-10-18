import type { ClarifyingOption } from '@/hooks/useDiscover'
import { ChoiceCard } from '@/components/hockiaAi/ChoiceCard'

interface ClarifyingQuestionCardProps {
  question: string
  options: ClarifyingOption[]
  onPick: (option: ClarifyingOption) => void
  /** The member's own answer ("Other"), sent as a new question. */
  onOther?: (text: string) => void
}

/**
 * Clarifying question as a Hockia AI choice card (2026-10-18): ready-made
 * answers with the recommended one first, plus "Other" to write your own.
 * Tapping an option submits its routed_query as a new user message.
 */
export default function ClarifyingQuestionCard({ question, options, onPick, onOther }: ClarifyingQuestionCardProps) {
  return (
    <ChoiceCard
      question={question}
      choices={options.map((o) => ({ value: o, label: o.label, description: o.description, recommended: o.recommended }))}
      onPick={(c) => onPick(c.value)}
      onOther={onOther}
      testId="ai-clarify"
    />
  )
}
