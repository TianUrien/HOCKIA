import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Header } from '@/components'
import { PulseTab } from '@/components/home/pulse/PulseTab'
import { YourWeekScreen } from '@/components/pulse/YourWeekScreen'
import { PullToRefresh } from '@/components/PullToRefresh'
import { useAuthStore } from '@/lib/auth'
import { queryClient } from '@/lib/queryClient'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useScrollRestore } from '@/hooks/useScrollRestore'

/**
 * /pulse — what the Home "Your week" card opens.
 *
 * Players and coaches on a phone get "Your week v2" (Figma New-Hockia
 * 42:276; founder rulings 2026-10-03): the calendar week, the availability
 * check-in, four own-number tiles, who looked (clubs and coaches only), a
 * reference that arrived and the week's neutral timeline.
 *
 * Desktop, and every other role on a phone, keep the existing Pulse — the
 * role-personalised modules (hero, applications, opportunities for you,
 * what's happening, movement cards, profile completion).
 */
const PHONE = '(max-width: 1023px)'

export default function PulsePage() {
  useScrollRestore()
  const role = useAuthStore((s) => s.profile?.role)
  const isTalent = role === 'player' || role === 'coach'
  const isPhone = useMediaQuery(PHONE)
  const v2 = isTalent && isPhone
  useDocumentTitle(v2 ? 'Your week' : 'Pulse')
  const navigate = useNavigate()
  // Pulse modules fetch via plain mount-effect hooks, not React Query —
  // remounting them is how pull-to-refresh refreshes their numbers. The v2
  // screen mixes both, so it is remounted and its queries invalidated.
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['pulse'] })
    setRefreshKey((k) => k + 1)
  }, [])

  if (v2) {
    return (
      <PullToRefresh onRefresh={handleRefresh}>
        <YourWeekScreen key={refreshKey} />
      </PullToRefresh>
    )
  }

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
