import type { ClarifyingOption } from '@/hooks/useDiscover'

interface ClarifyingQuestionCardProps {
  question: string
  options: ClarifyingOption[]
  onPick: (option: ClarifyingOption) => void
}

/**
 * Renders a clarifying-question response. Backend hasn't started emitting
 * `kind: 'clarifying_question'` yet — that's PR-4 — but the component is
 * here so PR-4 is a one-line wire-up at the dispatcher.
 *
 * Anatomy: question text + 2-4 disambiguation pills. Tapping a pill submits
 * the routed_query as a new user message.
 */
export default function ClarifyingQuestionCard({
  question,
  options,
  onPick,
}: ClarifyingQuestionCardProps) {
  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl rounded-tl-md px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <p className="text-[14px] text-gray-800 leading-[1.55] font-medium">{question}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Disambiguation options">
        {options.map((option, idx) => (
          <button
            key={`${option.label}-${idx}`}
            type="button"
            onClick={() => onPick(option)}
            className="
              inline-flex items-center
              min-h-[36px] px-4 py-2
              rounded-full
              border border-hockia-primary/30 bg-hockia-primary/[0.06]
              text-[12px] font-semibold text-hockia-primary tracking-[0.01em]
              hover:bg-hockia-primary/10 hover:border-hockia-primary/50
              active:scale-[0.98] active:bg-hockia-primary/20
              transition-all duration-150
              focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40
            "
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
