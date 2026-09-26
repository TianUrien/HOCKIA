import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Briefcase, ChevronDown, ChevronRight, MapPin } from 'lucide-react'
import type { DiscoverCta, OpportunityResultItem, SuggestedAction } from '@/hooks/useDiscover'
import ActionChipRow from './ActionChipRow'

interface OpportunityResultsResponseProps {
  message: string
  opportunities: OpportunityResultItem[]
  filters?: string[]
  cta?: DiscoverCta | null
  suggestedActions?: SuggestedAction[]
  onAction?: (action: SuggestedAction) => void
}

const COLLAPSED_COUNT = 5

/**
 * Open roles for a player / coach who asked Hockia AI for roles. Also used
 * for the empty state of that search, so the "what was searched" chips and
 * the way to every open role stay visible.
 *
 * Product rules: no match level, applicant count, level pill or reply-time
 * estimate — only the role's own facts.
 */
export default function OpportunityResultsResponse({
  message,
  opportunities,
  filters = [],
  cta,
  suggestedActions = [],
  onAction,
}: OpportunityResultsResponseProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? opportunities : opportunities.slice(0, COLLAPSED_COUNT)
  const hiddenCount = opportunities.length - COLLAPSED_COUNT
  const browse = cta ?? (opportunities.length === 0 ? { label: 'Browse all opportunities', route: '/opportunities' } : null)

  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {filters.length > 0 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1 font-medium uppercase tracking-[0.04em]">
            <Briefcase className="w-3 h-3" aria-hidden="true" />
            Searched
          </span>
          {filters.map(label => (
            <span
              key={label}
              className="inline-flex items-center px-2 py-[3px] rounded-full bg-gray-100 text-gray-700 font-medium text-[11px]"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      <p className="text-[14px] text-gray-800 leading-[1.55] whitespace-pre-line">{message}</p>

      {opportunities.length > 0 && (
        <ul className="mt-3 -mx-4 border-t border-gray-100 divide-y divide-gray-100">
          {visible.map(o => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => navigate(o.navigate_to)}
                className="flex w-full items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hockia-primary/40"
              >
                <span className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                  {o.logo_url ? (
                    <img src={o.logo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <Briefcase className="w-4 h-4 text-gray-400" aria-hidden="true" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 truncate">{o.title}</span>
                  <span className="block text-[12px] text-gray-600 truncate">
                    {[o.organization, o.position_label, o.category_label].filter(Boolean).join(' · ')}
                  </span>
                  {o.location_label && (
                    <span className="mt-0.5 flex items-center gap-1 text-[12px] text-gray-500 truncate">
                      <MapPin className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                      {o.location_label}
                    </span>
                  )}
                  {o.benefit_labels.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {o.benefit_labels.map(b => (
                        <span key={b} className="px-1.5 py-0.5 rounded-full bg-gray-100 text-[10px] font-medium text-gray-700">
                          {b}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="flex items-center gap-1 w-full justify-center min-h-[44px] px-4 py-2.5 text-xs font-medium text-hockia-primary hover:bg-hockia-primary/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hockia-primary/40"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
                {expanded ? 'Show less' : `Show all ${opportunities.length} roles`}
              </button>
            </li>
          )}
        </ul>
      )}

      {browse && (
        <button
          type="button"
          onClick={() => navigate(browse.route)}
          className="mt-3 inline-flex items-center gap-1.5 min-h-[40px] text-[13px] font-semibold text-hockia-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 rounded"
        >
          {browse.label}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}

      {suggestedActions.length > 0 && onAction && (
        <ActionChipRow actions={suggestedActions} onAction={onAction} />
      )}
    </div>
  )
}
