import type { AppliedSearch, SuggestedAction } from '@/hooks/useDiscover'
import ActionChipRow from './ActionChipRow'
import AppliedSearchStrip from './AppliedSearchStrip'

interface NoResultsCardProps {
  applied: AppliedSearch | null
  suggestedActions: SuggestedAction[]
  onAction: (action: SuggestedAction) => void
  /**
   * Backend-provided message. Preferred verbatim when present (the recovery
   * short-circuit ships specific copy); the legacy terse "I couldn't find
   * any X matching that." is replaced by calmer copy built from
   * applied.role_summary.
   */
  fallbackMessage?: string
}

/**
 * Calm no-results state for people / club searches (Figma 524:1644 for
 * roles lives in OpportunityResultsResponse). Left-aligned text, the
 * searched-for strip, then chips. Never renders without at least one chip.
 */
export default function NoResultsCard({
  applied,
  suggestedActions,
  onAction,
  fallbackMessage,
}: NoResultsCardProps) {
  const summary = applied?.role_summary
  const isLegacyTerseMessage =
    !!fallbackMessage && /^I couldn't find any .+ matching that\.?$/i.test(fallbackMessage.trim())
  const useBackendMessage = !!fallbackMessage && !isLegacyTerseMessage

  const headline = useBackendMessage
    ? fallbackMessage!
    : summary
      ? `I searched for ${summary} based on your profile, but I didn't find a strong match yet.`
      : "I didn't find a match yet."

  const subline = useBackendMessage
    ? null
    : summary
      ? "Let's try a different angle — pick one below."
      : 'Pick one of these to keep going:'

  const actions: SuggestedAction[] = suggestedActions.length > 0
    ? suggestedActions
    : [
        { label: 'Find opportunities', intent: { type: 'free_text', query: 'Find opportunities for my position' } },
        { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Show me products' } },
      ]

  return (
    <div data-testid="ai-no-results">
      {applied && <AppliedSearchStrip applied={applied} />}
      <p className="text-row text-ink-1 whitespace-pre-line">{headline}</p>
      {subline && <p className="mt-1 text-secondary text-ink-2 whitespace-pre-line">{subline}</p>}
      <ActionChipRow actions={actions} onAction={onAction} />
    </div>
  )
}
