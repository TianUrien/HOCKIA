import { useRef } from 'react'
import { Header } from '@/components'
import { HomeFeed } from '@/components/home/HomeFeed'
import { PostComposer } from '@/components/home/PostComposer'
import { SearchOverlay } from '@/components/search/SearchOverlay'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { useScrollDirection } from '@/hooks/useScrollDirection'
import type { HomeFeedItem } from '@/types/homeFeed'

export default function HomePage() {
  useScrollRestore()
  const scrollDirection = useScrollDirection()
  const prependItemRef = useRef<((item: HomeFeedItem) => void) | null>(null)

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-2xl mx-auto px-4 md:px-6 pt-24 pb-24">
        <div
          className={`sticky top-[var(--app-header-height,60px)] z-40 bg-gray-50 pb-4 transition-all duration-200 ${
            scrollDirection === 'down'
              ? '-translate-y-full opacity-0 pointer-events-none'
              : 'translate-y-0 opacity-100'
          }`}
        >
          <SearchOverlay />
          <div className="mt-4">
            <PostComposer onPostCreated={(item) => prependItemRef.current?.(item)} />
          </div>
        </div>
        <HomeFeed prependItemRef={prependItemRef} />
      </main>
    </div>
  )
}
