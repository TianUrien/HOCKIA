import { useRef, useCallback } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components'
import { HomeFeed } from '@/components/home/HomeFeed'
import { PostComposer } from '@/components/home/PostComposer'
import { YourWeekCard } from '@/components/home/YourWeekCard'
import { FullMatchPrivacyNotice } from '@/components/home/FullMatchPrivacyNotice'
import { SearchOverlay } from '@/components/search/SearchOverlay'
import { PullToRefresh } from '@/components/PullToRefresh'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import type { HomeFeedItem } from '@/types/homeFeed'

/**
 * Home (UI redesign 2026-09-19): one scroll — "Your week" (the Pulse
 * summary, tap → /pulse), the composer strip, then the community feed.
 * The Feed / Pulse tab switch is gone; Pulse is its own screen.
 */
export default function HomePage() {
  useScrollRestore()
  useDocumentTitle('Home')
  const [params] = useSearchParams()
  const prependItemRef = useRef<((item: HomeFeedItem) => void) | null>(null)
  const queryClient = useQueryClient()

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['home-feed'] })
  }, [queryClient])

  // Links in the wild (and the profile-views / application emails) still
  // point at /home?tab=pulse — that card lives on /pulse now.
  if (params.get('tab') === 'pulse') return <Navigate to="/pulse" replace />

  return (
    <div className="min-h-screen bg-white md:bg-[#F4F4F6]">
      <Header />

      <PullToRefresh onRefresh={handleRefresh}>
        <main className="mx-auto max-w-2xl pt-20 pb-24">
          {/* The mobile header carries the search icon; on desktop the
              resting pill stays where it was. One instance either way. */}
          <div className="px-4 pt-3 md:px-6">
            <SearchOverlay triggerClassName="hidden lg:block lg:mb-3" />
            {/* One-time, players only; renders nothing once answered. */}
            <FullMatchPrivacyNotice className="mb-3" />
            <YourWeekCard />
          </div>

          <div className="mt-3 bg-white md:mx-6 md:rounded-2xl md:shadow-[0_1px_2px_rgba(20,20,28,0.04)]">
            <PostComposer onPostCreated={(item) => prependItemRef.current?.(item)} />
          </div>

          <div className="border-t border-line md:mt-2 md:border-0">
            <HomeFeed prependItemRef={prependItemRef} />
          </div>
        </main>
      </PullToRefresh>
    </div>
  )
}
