import { useState, useRef, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DiscoverResult, ParsedFilters } from '@/hooks/useDiscover'
import DiscoverResultCard from '@/components/DiscoverResultCard'
import DiscoverFilterChips from '@/components/DiscoverFilterChips'

interface SearchResultsResponseProps {
  message: string
  results: DiscoverResult[]
  parsedFilters?: ParsedFilters | null
}

/** Results shown before the list is expanded. */
const COLLAPSED_COUNT = 3

/**
 * Renders a successful search: short message + result list + read-only filter
 * chips under the bubble. Extracted from the prior inline render in
 * DiscoverChat.tsx so the dispatcher can compose it cleanly.
 *
 * The result list is collapsible: it shows the first COLLAPSED_COUNT results
 * with a "Show all N results" toggle. The toggle is a true two-way control —
 * when expanded it becomes "Show less", the chevron flips, and collapsing
 * scrolls the result section back into view so a long (10+) list never
 * strands the user at the bottom of the page.
 */
export default function SearchResultsResponse({
  message,
  results,
  parsedFilters,
}: SearchResultsResponseProps) {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const visible = expanded ? results : results.slice(0, COLLAPSED_COUNT)
  const hiddenCount = results.length - COLLAPSED_COUNT

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
        className="bg-white border border-gray-200/80 rounded-2xl rounded-tl-md px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] scroll-mt-3"
      >
        <p className="text-[14px] text-gray-800 leading-[1.55] whitespace-pre-line">{message}</p>
        {results.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {visible.map(r => (
              <DiscoverResultCard key={r.id} result={r} />
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={toggle}
                className="flex items-center gap-1 w-full justify-center min-h-[44px] py-2 text-xs font-medium text-[#8026FA] hover:text-[#924CEC] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40 rounded-lg"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
                {expanded ? 'Show less' : `Show all ${results.length} results`}
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
