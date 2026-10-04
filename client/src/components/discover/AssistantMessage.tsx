import { useNavigate } from 'react-router-dom'
import type { DiscoverChatMessage, SuggestedAction } from '@/hooks/useDiscover'
import { useDiscoverChat } from '@/hooks/useDiscover'
import { useAuthStore } from '@/lib/auth'
import {
  CAP_REACHED_COPY,
  CONNECTION_ERROR_COPY,
  SEARCHING_LABEL,
  cantAnswerChips,
  capReachedChips,
  errorChips,
  isCandidateRole,
  stripRankingLines,
} from '@/lib/hockiaAi'
import CannedRedirectCard from './CannedRedirectCard'
import ClarifyingQuestionCard from './ClarifyingQuestionCard'
import NoResultsCard from './NoResultsCard'
import OpportunityResultsResponse from './OpportunityResultsResponse'
import RecommendationResponse from './RecommendationResponse'
import SearchResultsResponse from './SearchResultsResponse'
import SoftErrorCard from './SoftErrorCard'
import TextResponse from './TextResponse'

interface AssistantMessageProps {
  msg: DiscoverChatMessage
}

/**
 * Loading state (Figma 524:1575): "Searching…" with three animated dots.
 * No skeleton cards.
 */
export function SearchingIndicator() {
  return (
    <div role="status" aria-label={SEARCHING_LABEL} className="flex items-center gap-1.5 text-row text-ink-2" data-testid="ai-searching">
      <span>{SEARCHING_LABEL}</span>
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="h-[5px] w-[5px] rounded-full bg-ink-2 animate-dotWave"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </span>
    </div>
  )
}

/**
 * Assistant-side message dispatcher. Reads `msg.kind` (backend envelope) and
 * picks the right leaf. Every leaf is left-aligned text with optional cards
 * and chips (Figma 44:321); there is no avatar and no bubble. Navigate chips
 * are resolved here because the store has no router.
 */
export default function AssistantMessage({ msg }: AssistantMessageProps) {
  const navigate = useNavigate()
  const submitAction = useDiscoverChat(s => s.submitAction)
  const loadMore = useDiscoverChat(s => s.loadMore)
  const viewerRole = useAuthStore(s => s.profile?.role ?? null)
  const candidate = isCandidateRole(viewerRole)

  const handleAction = (action: SuggestedAction) => {
    if (action.intent.type === 'navigate') {
      navigate(action.intent.route)
      return
    }
    submitAction(action.intent)
  }

  // Players and coaches are never ranked against others; strip any such
  // line the model may have written (the backend's own copy never does).
  const content = candidate ? stripRankingLines(msg.content) : msg.content

  const body = (() => {
    if (msg.status === 'sending') {
      return <SearchingIndicator />
    }

    if (msg.status === 'error') {
      // Hard failures (network down, malformed response) render the same
      // neutral card as backend soft errors, with the recovery chips below.
      return (
        <SoftErrorCard
          message={CONNECTION_ERROR_COPY}
          suggestedActions={errorChips(viewerRole)}
          onAction={handleAction}
        />
      )
    }

    switch (msg.kind) {
      case 'cap_reached':
        return (
          <SoftErrorCard
            message={content || CAP_REACHED_COPY}
            suggestedActions={capReachedChips(viewerRole)}
            onAction={handleAction}
          />
        )

      case 'opportunity_results':
        return (
          <OpportunityResultsResponse
            message={content}
            opportunities={msg.opportunities ?? []}
            openRolesTotal={msg.open_roles_total}
            cta={msg.cta}
            suggestedActions={msg.suggested_actions}
            onAction={handleAction}
          />
        )

      case 'no_results':
        // An empty role search keeps the role answer shape: the zero-result
        // message, the "From N open roles" line and the way to every role.
        if (msg.opportunity_filters) {
          return (
            <OpportunityResultsResponse
              message={content}
              opportunities={[]}
              openRolesTotal={msg.open_roles_total}
              cta={msg.cta}
              suggestedActions={msg.suggested_actions}
              onAction={handleAction}
            />
          )
        }
        return (
          <NoResultsCard
            applied={msg.applied ?? null}
            suggestedActions={msg.suggested_actions ?? []}
            onAction={handleAction}
            fallbackMessage={content}
          />
        )

      case 'soft_error':
        return (
          <SoftErrorCard
            message={content}
            suggestedActions={msg.suggested_actions?.length ? msg.suggested_actions : errorChips(viewerRole)}
            onAction={handleAction}
          />
        )

      case 'clarifying_question': {
        const opts = msg.clarifying_options ?? []
        if (opts.length === 0) {
          return (
            <TextResponse
              message={content}
              suggestedActions={msg.suggested_actions?.length ? msg.suggested_actions : cantAnswerChips(viewerRole)}
              onAction={handleAction}
            />
          )
        }
        return (
          <ClarifyingQuestionCard
            question={content}
            options={opts}
            onPick={(option) => submitAction({ type: 'free_text', query: option.routed_query })}
          />
        )
      }

      case 'canned_redirect':
        return <CannedRedirectCard message={content} cta={msg.cta} />

      case 'results':
        return (
          <SearchResultsResponse
            message={content}
            results={msg.results ?? []}
            parsedFilters={msg.parsed_filters ?? null}
            hasMore={msg.has_more ?? false}
            loadingMore={msg.loading_more ?? false}
            onLoadMore={() => loadMore(msg.id)}
            isCompound={msg.is_compound ?? false}
          />
        )

      case 'recommendation':
        return (
          <RecommendationResponse
            message={content}
            recommendations={msg.recommendations ?? []}
            secondaryNote={msg.secondary_note ?? null}
            suggestedActions={msg.suggested_actions}
            onAction={handleAction}
          />
        )

      case 'text':
      default:
        // Can't answer / out of scope (Figma 524:1715): when the backend
        // sends no chips, offer the two ways forward.
        return (
          <TextResponse
            message={content}
            suggestedActions={msg.suggested_actions?.length ? msg.suggested_actions : cantAnswerChips(viewerRole)}
            onAction={handleAction}
          />
        )
    }
  })()

  return (
    <div className="w-full animate-fadeSlideIn" data-testid="ai-answer" data-kind={msg.status === 'complete' ? msg.kind ?? 'text' : msg.status}>
      {body}
    </div>
  )
}
