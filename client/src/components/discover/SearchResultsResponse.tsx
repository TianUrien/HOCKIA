import { useState, useRef, useCallback } from 'react'
import { ChevronDown, Plus, Loader2 } from 'lucide-react'
import type { DiscoverResult, ParsedFilters } from '@/hooks/useDiscover'
import DiscoverResultCard from '@/components/DiscoverResultCard'
import DiscoverFilterChips from '@/components/DiscoverFilterChips'

interface SearchResultsResponseProps {
  message: string
  results: DiscoverResult[]
  parsedFilters?: ParsedFilters | null
  /** Phase 1b — backend has further distinct results past what's loaded. */
  hasMore?: boolean
  /** Phase 1b — a "Show more" fetch is in flight. */
  loadingMore?: boolean
  /** Phase 1b — fetch + append the next batch. */
  onLoadMore?: () => void
  /** Compound multi-role search — skip the collapse-to-3 so the headline
   *  count matches what's visible ("3 players and 1 coach" → all 4). */
  isCompound?: boolean
}

/** Results shown before the list is expanded. Matches the default people-
 *  search return size — a 5-result default search now shows all 5 without
 *  the user needing to tap "Show all" (production audit #6). Longer lists
 *  still collapse to 5 with a "Show all N" expander. */
const COLLAPSED_COUNT = 5

/**
 * Renders a successful search: short message + result list + read-only filter
 * chips under the bubble. Extracted from the prior inline render in
 * DiscoverChat.tsx so the dispatcher can compose it cleanly.
 *
 * The result list has two independent affordances:
 *  - a client-side collapse: the first COLLAPSED_COUNT rows show with a
 *    "Show all N results" / "Show less" toggle (collapsing scrolls the
 *    section back into view so a long list never strands the user);
 *  - a backend "Show more results" control (Phase 1b): when the search has
 *    further distinct results, it pages in the next batch via offset
 *    pagination. It only appears once every loaded row is already visible,
 *    so it never competes with the collapse toggle.
 */
export default function SearchResultsResponse({
  message,
  results,
  parsedFilters,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  isCompound = false,
}: SearchResultsResponseProps) {
  // Compound results auto-expand: every requested role must be visible so
  // "3 players and 1 coach" doesn't hide the lone coach behind "Show all".
  const [expanded, setExpanded] = useState(isCompound)
  const containerRef = useRef<HTMLDivElement>(null)
  const visible = expanded ? results : results.slice(0, COLLAPSED_COUNT)
  const hiddenCount = results.length - COLLAPSED_COUNT
  // Every loaded row is on screen — either expanded, or there were never
  // more than COLLAPSED_COUNT to begin with.
  const allVisible = expanded || results.length <= COLLAPSED_COUNT
  const showLoadMore = hasMore && allVisible && !!onLoadMore
  // Suppress the collapse toggle on compound queries — the curated default
  // is "show every role you asked for", not "hide one behind a button".
  const showCollapseToggle = !isCompound && hiddenCount > 0

  // "Show more results" pages in a new batch — expand first so the appended
  // rows are visible rather than collapsing back behind "Show all N".
  const handleLoadMore = useCallback(() => {
    setExpanded(true)
    onLoadMore?.()
  }, [onLoadMore])

  const toggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      // Collapsing a long list shrinks the page sharply — bring the result
      // section back into view so the user isn't left stranded in blank
      // space below where the list used to be. rAF lets React commit the
      // shorter DOM before we measure the scroll target.
      if (!next) {
        requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
      return next
    })
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        className="bg-white border border-gray-200/80 rounded-2xl px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] scroll-mt-3"
      >
        <p className="text-[14px] text-gray-800 leading-[1.55] whitespace-pre-line">{message}</p>
        {results.length > 0 && (
          // Flat list — full-bleed within the bubble padding, rows divided
          // by hairlines (no per-card boxes). The toggle / "Show more" are
          // list rows too, so they sit flush with the result rows.
          <div className="mt-3 -mx-4 border-t border-gray-100 divide-y divide-gray-100">
            {visible.map(r => (
              <DiscoverResultCard key={r.id} result={r} />
            ))}
            {showCollapseToggle && (
              <button
                type="button"
                onClick={toggle}
                className="flex items-center gap-1 w-full justify-center min-h-[44px] px-4 py-2.5 text-xs font-medium text-[#8026FA] hover:bg-[#8026FA]/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8026FA]/40"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
                {expanded ? 'Show less' : `Show all ${results.length} results`}
              </button>
            )}
            {showLoadMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-1.5 w-full justify-center min-h-[44px] px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-[#8026FA] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8026FA]/40 disabled:opacity-60 disabled:cursor-default"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Searching…
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Show more results
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
      {parsedFilters && (
        <div className="mt-1.5 pl-1">
          <DiscoverFilterChips filters={parsedFilters} />
        </div>
      )}
    </>
  )
}
