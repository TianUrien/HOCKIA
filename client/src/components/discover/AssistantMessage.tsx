import { Bot } from 'lucide-react'
import type { DiscoverChatMessage, SuggestedAction } from '@/hooks/useDiscover'
import { useDiscoverChat } from '@/hooks/useDiscover'
import CannedRedirectCard from './CannedRedirectCard'
import ClarifyingQuestionCard from './ClarifyingQuestionCard'
import NoResultsCard from './NoResultsCard'
import RecommendationResponse from './RecommendationResponse'
import SearchResultsResponse from './SearchResultsResponse'
import SoftErrorCard from './SoftErrorCard'
import TextResponse from './TextResponse'

/**
 * Hardcoded soft-error chips for the legacy hard-failure path. Mirrors
 * `getSoftErrorActions()` in supabase/functions/_shared/suggested-actions.ts.
 * Used when the network/backend fails so badly that no body parses (and
 * therefore no chips arrive). A genuine offline state still gets the calm
 * recovery treatment.
 */
const FALLBACK_HARD_ERROR_CHIPS: SuggestedAction[] = [
  { label: 'Retry', intent: { type: 'retry' } },
  { label: 'Broaden search', intent: { type: 'free_text', query: 'Find clubs near me' } },
  { label: 'Browse opportunities', intent: { type: 'free_text', query: 'Find opportunities for my position' } },
  { label: 'Start over', intent: { type: 'clear' } },
]

interface AssistantMessageProps {
  msg: DiscoverChatMessage
}

/**
 * Compact search-status bubble shown while the LLM call is in flight.
 * Sits inline in the chat flow — a calm, lightweight "thinking" state at
 * roughly the height of a normal AI message, not a full card. The left
 * indicator is three connected dots with a subtle green progress wave.
 */
function SearchingIndicator() {
  return (
    <div
      role="status"
      aria-label="Searching"
      className="inline-flex items-center gap-3 bg-white border border-gray-200 rounded-2xl rounded-tl-md px-3.5 py-2.5 shadow-sm"
    >
      {/* Connected dots — subtle grey track, green wave travelling across. */}
      <div className="flex items-center flex-shrink-0" aria-hidden="true">
        {[0, 1, 2].map(i => (
          <span key={i} className="flex items-center">
            <span
              className="w-[7px] h-[7px] rounded-full bg-emerald-500 animate-dotWave"
              style={{ animationDelay: `${i * 200}ms` }}
            />
            {i < 2 && <span className="w-3.5 h-px bg-gray-200" />}
          </span>
        ))}
      </div>
      {/* Status text — kept generic so the bubble is reusable across all
          Hockia AI search types, not just profile lookups. */}
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 leading-tight">Searching…</p>
        <p className="text-[12px] text-gray-500 leading-tight mt-0.5">
          Finding the best results
        </p>
      </div>
    </div>
  )
}

/**
 * Assistant-side message dispatcher. Reads `msg.kind` (set by the backend
 * envelope shipped in PR-1) and picks the right leaf component. Falls back
 * to plain text for messages without a kind (back-compat with cached chat
 * state from before Phase 1A).
 */
export default function AssistantMessage({ msg }: AssistantMessageProps) {
  const submitAction = useDiscoverChat(s => s.submitAction)
  const loadMore = useDiscoverChat(s => s.loadMore)

  const handleAction = (action: SuggestedAction) => submitAction(action.intent)

  const body = (() => {
    if (msg.status === 'sending') {
      return <SearchingIndicator />
    }

    if (msg.status === 'error') {
      // PR-3: hard failures (network down, malformed response, anything
      // supabase-js throws on before the body is parsed) render the same
      // calm SoftErrorCard as backend-emitted soft_errors. We never show
      // the harsh red block. Chips are hardcoded since no body parsed.
      return (
        <SoftErrorCard
          message="I had trouble connecting just now — let's try a different angle."
          suggestedActions={FALLBACK_HARD_ERROR_CHIPS}
          onAction={handleAction}
        />
      )
    }

    // Successful response — pick by kind.
    switch (msg.kind) {
      case 'no_results':
        return (
          <NoResultsCard
            applied={msg.applied ?? null}
            suggestedActions={msg.suggested_actions ?? []}
            onAction={handleAction}
            fallbackMessage={msg.content}
          />
        )

      case 'soft_error':
        // PR-3 ships this from the backend. Used for: RPC failure, doubly-
        // degraded keyword fallback, force-debug query (staging only),
        // non-search LLM timeouts (knowledge / self_advice / greeting).
        return (
          <SoftErrorCard
            message={msg.content}
            suggestedActions={msg.suggested_actions ?? []}
            onAction={handleAction}
          />
        )

      case 'clarifying_question': {
        // Phase 4 audit P2-1: when the LLM emits clarifying_question with
        // an empty options array, the card renders as a question with no
        // buttons under it — a dead end. Fall through to TextResponse so
        // any suggested_actions chips become the user's forward path
        // instead of leaving them stuck.
        const opts = msg.clarifying_options ?? []
        if (opts.length === 0) {
          return (
            <TextResponse
              message={msg.content}
              suggestedActions={msg.suggested_actions}
              onAction={handleAction}
            />
          )
        }
        return (
          <ClarifyingQuestionCard
            question={msg.content}
            options={opts}
            onPick={(option) => submitAction({ type: 'free_text', query: option.routed_query })}
          />
        )
      }

      case 'canned_redirect':
        return <CannedRedirectCard message={msg.content} cta={msg.cta} />

      case 'results':
        return (
          <SearchResultsResponse
            message={msg.content}
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
            message={msg.content}
            recommendations={msg.recommendations ?? []}
            secondaryNote={msg.secondary_note ?? null}
            suggestedActions={msg.suggested_actions}
            onAction={handleAction}
          />
        )

      case 'text':
      default:
        return (
          <TextResponse
            message={msg.content}
            suggestedActions={msg.suggested_actions}
            onAction={handleAction}
          />
        )
    }
  })()

  // A search-results message renders full-width: the flat, edge-to-edge
  // result list needs the room — the chat avatar indent + 85% width cap
  // would crush it on mobile. Other assistant messages keep avatar + bubble.
  if (msg.kind === 'results') {
    return <div className="w-full animate-fadeSlideIn">{body}</div>
  }

  return (
    <div className="flex items-start gap-2.5 animate-fadeSlideIn">
      <div
        className="
          flex-shrink-0 w-8 h-8 rounded-full
          bg-gradient-to-br from-hockia-primary to-hockia-secondary
          flex items-center justify-center mt-0.5
          shadow-sm shadow-hockia-primary/15
        "
        aria-hidden="true"
      >
        <Bot className="w-4 h-4 text-white" />
      </div>
      <div
        className={
          // Phase 4 audit P2-5: no-results bubbles carry the multi-paragraph
          // compose-pass diagnoses (P0-1 fixed the line breaks; P2-5 widens
          // the column so the prose doesn't feel cramped on mobile).
          msg.kind === 'no_results'
            ? 'flex-1 min-w-0 max-w-[92%] sm:max-w-[80%]'
            : 'flex-1 min-w-0 max-w-[85%] sm:max-w-[75%]'
        }
      >
        {body}
      </div>
    </div>
  )
}
