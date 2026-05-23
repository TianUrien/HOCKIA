import RecommendationCard from './RecommendationCard'
import type { RecommendationRow, SuggestedAction } from '@/hooks/useDiscover'

interface RecommendationResponseProps {
  message: string
  recommendations: RecommendationRow[]
  secondaryNote?: string | null
  suggestedActions?: SuggestedAction[]
  onAction: (action: SuggestedAction) => void
}

/**
 * Phase 5 — owner recruitment recommendation. Renders the honest
 * orientation sentence (full triage breakdown, including Not a fit), up to
 * two recommended applicant cards, an optional nudge about other openings,
 * and any suggested-action chips for the edge cases (no opportunities, no
 * applicants, all rejected). The cards live inline in the AI bubble — this
 * is a curated short answer, not a directory dump.
 */
export default function RecommendationResponse({
  message,
  recommendations,
  secondaryNote,
  suggestedActions,
  onAction,
}: RecommendationResponseProps) {
  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl rounded-tl-md px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] space-y-3">
      {/* Orientation message — always shown. */}
      <p className="text-[14px] text-gray-800 leading-[1.55] whitespace-pre-line">{message}</p>

      {/* Recommendation cards (0–2). */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          {recommendations.map(rec => (
            <RecommendationCard key={rec.applicant_id} rec={rec} />
          ))}
        </div>
      )}

      {/* Secondary openings nudge. */}
      {secondaryNote && (
        <p className="text-xs text-gray-500 italic leading-snug">{secondaryNote}</p>
      )}

      {/* Suggested actions for edge cases (no opps, no applicants, all rejected). */}
      {suggestedActions && suggestedActions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {suggestedActions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAction(a)}
              className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium text-[#8026FA] bg-[#8026FA]/5 hover:bg-[#8026FA]/10 transition-colors"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
