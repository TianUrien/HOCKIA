import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * AI scout bar (Home V2 Phase 2, Q7: replaces the keyword pill for club +
 * brand). A real input: type a query → /discover?q=… (the seeded query
 * auto-sends there); tap-through empty → /discover ready to type.
 */
const MODULE_ID = 'ai_scout_bar'
const POSITION = 1

export function AiScoutBar() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  const submit = () => {
    trackModuleClick(MODULE_ID, POSITION)
    const q = query.trim()
    navigate(q ? `/discover?q=${encodeURIComponent(q)}` : '/discover')
  }

  return (
    <form
      ref={ref as React.Ref<HTMLFormElement>}
      className="mb-6"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <div className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-white px-3 py-2 shadow-sm focus-within:border-hockia-primary/40">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-hockia-primary to-hockia-secondary">
          <Sparkles className="h-4 w-4 text-white" />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={'Ask the AI scout: "available defenders with EU passport"'}
          className="min-w-0 flex-1 bg-transparent text-sm text-[#14141c] placeholder:text-gray-400 focus:outline-none"
          aria-label="Ask the AI scout"
        />
        <button
          type="submit"
          aria-label="Search with AI scout"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-hockia-primary hover:text-white"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  )
}
