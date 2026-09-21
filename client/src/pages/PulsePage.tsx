import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Header } from '@/components'
import { PulseTab } from '@/components/home/pulse/PulseTab'
import { PullToRefresh } from '@/components/PullToRefresh'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useScrollRestore } from '@/hooks/useScrollRestore'

/**
 * /pulse — "Your week on HOCKIA" (UI redesign 2026-09-19).
 *
 * Pulse used to be a tab on Home; it is now its own screen reached from the
 * "Your week" summary card at the top of the feed (and the old ?tab=pulse
 * links, which redirect here). The content is the same role-personalised
 * modules as before — hero, applications, opportunities for you, what's
 * happening, movement cards, profile completion.
 */
export default function PulsePage() {
  useScrollRestore()
  useDocumentTitle('Pulse')
  const navigate = useNavigate()
  // Pulse modules fetch via plain mount-effect hooks, not React Query —
  // remounting them is how pull-to-refresh refreshes their numbers.
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = useCallback(async () => { setRefreshKey((k) => k + 1) }, [])

  return (
    <div className="min-h-screen bg-[#F4F4F6]">
      <Header />
      <PullToRefresh onRefresh={handleRefresh}>
        <main className="mx-auto max-w-2xl pt-20 pb-24">
          <div className="flex items-center gap-1 px-2 pb-2 pt-2 md:px-4">
            <button
              type="button"
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/home'))}
              className="flex h-11 w-11 items-center justify-center rounded-full text-gray-900 transition-colors hover:bg-gray-200/60"
              aria-label="Back"
            >
              <ArrowLeft className="h-[22px] w-[22px]" strokeWidth={1.75} />
            </button>
            <h1 className="text-[22px] font-bold leading-7 text-gray-900">Pulse</h1>
          </div>
          <PulseTab key={refreshKey} />
        </main>
      </PullToRefresh>
    </div>
  )
}
