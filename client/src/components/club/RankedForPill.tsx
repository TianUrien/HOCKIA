import { ChevronDown } from 'lucide-react'

/**
 * The one recruiting-context control (Figma U1 203:1764, ruling 16 Oct
 * 2026): an outlined pill "Ranked for <context>" that opens the Ranked for
 * sheet. Same pill on Community, Find players, Shortlist and Saved candidates.
 */
export function RankedForPill({ label, onClick, testId = 'ranked-for-pill', className }: { label: string; onClick: () => void; testId?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-line bg-white py-1.5 pl-3 pr-2.5 text-[13px] leading-[18px] transition-colors hover:border-ink-4 ${className ?? ''}`}
      aria-label={`Ranked for ${label}. Change the context`}
      data-testid={testId}
    >
      <span className="shrink-0 text-ink-2">Ranked for</span>
      <span className="min-w-0 truncate font-semibold text-ink-1">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={2} aria-hidden="true" />
    </button>
  )
}
