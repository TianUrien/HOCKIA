import type { AppliedSearch, SuggestedAction } from '@/hooks/useDiscover'
import { HockiaHelpLine } from '@/components/HockiaHelpLine'
import ActionChipRow from './ActionChipRow'
import AppliedSearchStrip from './AppliedSearchStrip'
import { useHockiaAiT } from '@/i18n/ns/hockiaAi'

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
  const t = useHockiaAiT()
  const summary = applied?.role_summary
  const isLegacyTerseMessage =
    !!fallbackMessage && /^I couldn't find any .+ matching that\.?$/i.test(fallbackMessage.trim())
  const useBackendMessage = !!fallbackMessage && !isLegacyTerseMessage

  const headline = useBackendMessage
    ? fallbackMessage!
    : summary
      ? t('discover.noResultsSummary', { summary })
      : t('discover.noResults')

  const subline = useBackendMessage
    ? null
    : summary
      ? t('discover.noResultsSubSummary')
      : t('discover.noResultsSub')

  const actions: SuggestedAction[] = suggestedActions.length > 0
    ? suggestedActions
    : [
        // The query is the English prompt Hockia AI reads; the label follows the language.
        { label: t('discover.chipFindOpportunities'), intent: { type: 'free_text', query: t('discover.chipFindOpportunitiesQuery', { lng: 'en' }), shown: t('discover.chipFindOpportunitiesQuery') } },
        { label: t('discover.chipBrowseMarketplace'), intent: { type: 'free_text', query: t('discover.chipBrowseMarketplaceQuery', { lng: 'en' }), shown: t('discover.chipBrowseMarketplaceQuery') } },
      ]

  return (
    <div data-testid="ai-no-results">
      {applied && <AppliedSearchStrip applied={applied} />}
      <p className="text-row text-ink-1 whitespace-pre-line">{headline}</p>
      {subline && <p className="mt-1 text-secondary text-ink-2 whitespace-pre-line">{subline}</p>}
      <ActionChipRow actions={actions} onAction={onAction} />
      <HockiaHelpLine moment="ai_no_result" className="mt-2" />
    </div>
  )
}
