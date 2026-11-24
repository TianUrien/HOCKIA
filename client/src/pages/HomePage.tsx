import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components'
import { FullMatchPrivacyNotice } from '@/components/home/FullMatchPrivacyNotice'
import { SearchOverlay } from '@/components/search/SearchOverlay'
import { PullToRefresh } from '@/components/PullToRefresh'
import { HomeV1Feed } from '@/components/home/v1/HomeV1Feed'
import { PostEntry } from '@/components/home/v1/PostEntry'
import { GoalCard } from '@/components/home/goal/GoalCard'
import { GearRail } from '@/components/offers/GearRail'
import { CountryConfirmCard } from '@/components/home/CountryConfirmCard'
import { BrandHomeSummary } from '@/components/home/BrandHomeSummary'
import { SigningPromptSheet } from '@/components/home/v1/SigningPromptSheet'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import type { HomeFeedItem } from '@/types/homeFeed'
import { useHomeT } from '@/i18n/ns/home'

// The composer is only needed after a tap on "+" (spec: lazy-loaded).
const PostComposerModal = lazy(() => import('@/components/home/PostComposerModal').then((m) => ({ default: m.PostComposerModal })))

/**
 * Home (Figma New Hockia 2 Draft, page 02, section HS; founder 2026-11-24):
 * a feed of posts by members, Instagram or LinkedIn style.
 *   1 Header: wordmark, "+" New post, Search
 *   2 Post entry: your photo and "Share something from your hockey"
 *   3 Posts, newest first (get_home_feed_v2 with p_posts_only)
 *   4 One row of "Opportunities for you" after the 2nd post
 *   5 The end says so and offers to post
 * The Next step card and the rows of people left Home; /pulse keeps "Your
 * activity" because old native apps link to it.
 */
export default function HomePage() {
  const t = useHomeT()
  useScrollRestore()
  useDocumentTitle(t('page.documentTitle'))
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const prependItemRef = useRef<((item: HomeFeedItem) => void) | null>(null)
  const [composing, setComposing] = useState(false)

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['home-feed'] }),
      queryClient.invalidateQueries({ queryKey: ['home-people'] }),
    ])
  }, [queryClient])

  // Links in the wild (and the profile-views / application emails) still
  // point at /home?tab=pulse — that card lives on /pulse now.
  if (params.get('tab') === 'pulse') return <Navigate to="/pulse" replace />

  const openComposer = () => setComposing(true)

  return (
    <div className="min-h-screen bg-white">
      <Header onNewPost={openComposer} hideOnScroll />

      <PullToRefresh onRefresh={handleRefresh}>
        <main className="mx-auto max-w-2xl pt-under-header pb-24 md:pb-10">
          <div className="hidden px-4 pt-3 lg:flex lg:items-center lg:gap-3">
            <SearchOverlay triggerClassName="flex-1" />
            {/* Tonal, not a second Primary: the end of the feed carries the
                screen's one Primary (design audit B6). */}
            <button type="button" onClick={openComposer} className="flex h-11 shrink-0 items-center rounded-full bg-brand-soft px-5 text-[15px] font-semibold text-brand-primary transition-colors hover:bg-brand-soft-hover" data-testid="home-new-post">
              {t('page.newPost')}
            </button>
          </div>
          {/* One-time, players only; renders nothing once answered. */}
          <div className="px-4 empty:hidden">
            <FullMatchPrivacyNotice className="mt-3" />
          </div>

          <HomeV1Feed
            prependItemRef={prependItemRef}
            onCompose={openComposer}
            header={
              <>
                {/* Posting is the first thing Home offers (founder 2026-11-24). */}
                <PostEntry onCompose={openComposer} />
                {/* No country on the profile: ask first, everything below picks by place (2026-11-07). */}
                <CountryConfirmCard />
                {/* Brands: their own results first, the feed below (2026-11-07). */}
                <BrandHomeSummary />
              </>
            }
            afterFirst={
              <>
                {/* Goal, then gear and deals (Figma YG G1 / HR1, founder 2026-10-25),
                    after the first post. */}
                <GoalCard />
                <GearRail />
              </>
            }
          />
        </main>
      </PullToRefresh>

      {/* H14: clubs, after a player confirms a signing. */}
      <SigningPromptSheet />

      {composing && (
        <Suspense fallback={null}>
          <PostComposerModal
            isOpen
            onClose={() => setComposing(false)}
            onPostCreated={(item) => prependItemRef.current?.(item)}
          />
        </Suspense>
      )}
    </div>
  )
}
