import { useRef, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components'
import { HomeFeed } from '@/components/home/HomeFeed'
import { PostComposer } from '@/components/home/PostComposer'
import { SearchOverlay } from '@/components/search/SearchOverlay'
import { PullToRefresh } from '@/components/PullToRefresh'
import { HomeTabBar } from '@/components/home/HomeTabs'
import { FeedTabHint } from '@/components/home/FeedTabHint'
import { useHomeTab } from '@/hooks/useHomeTab'
import { PulseTab } from '@/components/home/pulse/PulseTab'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { useScrollDirection } from '@/hooks/useScrollDirection'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import type { HomeFeedItem } from '@/types/homeFeed'

export default function HomePage() {
  useScrollRestore()
  useDocumentTitle('Home')
  const scrollDirection = useScrollDirection()
  const prependItemRef = useRef<((item: HomeFeedItem) => void) | null>(null)
  const queryClient = useQueryClient()
  const [tab, setTab] = useHomeTab()
  // Pulse modules fetch via plain mount-effect hooks, not React Query, so a
  // ['home-feed'] invalidation doesn't touch them. Bumping this key remounts
  // PulseTab, re-running its hooks — makes pull-to-refresh actually refresh
  // the hero stats / applications / pulse cards on the default tab.
  const [pulseRefreshKey, setPulseRefreshKey] = useState(0)

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['home-feed'] })
    setPulseRefreshKey((k) => k + 1)
  }, [queryClient])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <PullToRefresh onRefresh={handleRefresh}>
      <main className="max-w-2xl mx-auto pt-20 pb-24">
        {/* Pulse (default, state-of-your-week) / Feed (community). Sticky so
            the switch stays reachable; hides on scroll-down like the old
            composer bar did. */}
        <div
          className={`sticky top-[var(--app-header-height,60px)] z-40 bg-gray-50 pb-3 pt-2 transition-all duration-200 ${
            scrollDirection === 'down'
              ? '-translate-y-full opacity-0 pointer-events-none'
              : 'translate-y-0 opacity-100'
          }`}
        >
          <HomeTabBar tab={tab} onChange={setTab} />
          <FeedTabHint tab={tab} onGoToFeed={() => setTab('feed')} />
        </div>

        {tab === 'pulse' ? (
          <PulseTab key={pulseRefreshKey} />
        ) : (
          <>
            <div className="px-4 md:px-6">
              <SearchOverlay />
              <div className="mt-4">
                <PostComposer onPostCreated={(item) => prependItemRef.current?.(item)} />
              </div>
            </div>
            <div className="mt-4">
              <HomeFeed prependItemRef={prependItemRef} />
            </div>
          </>
        )}
      </main>
      </PullToRefresh>
    </div>
  )
}
