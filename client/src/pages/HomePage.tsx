import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components'
import { FullMatchPrivacyNotice } from '@/components/home/FullMatchPrivacyNotice'
import { SearchOverlay } from '@/components/search/SearchOverlay'
import { PullToRefresh } from '@/components/PullToRefresh'
import { HomeV1Feed } from '@/components/home/v1/HomeV1Feed'
import { NextStepCard } from '@/components/home/v1/NextStepCard'
import { PeopleRow } from '@/components/home/v1/PeopleRow'
import { GoalCard } from '@/components/home/goal/GoalCard'
import { GearRail } from '@/components/offers/GearRail'
import { SigningPromptSheet } from '@/components/home/v1/SigningPromptSheet'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useCoachPulseMode } from '@/hooks/useCoachPulseMode'
import { useAuthStore } from '@/lib/auth'
import type { HomeFeedItem } from '@/types/homeFeed'

// The composer is only needed after a tap on "+" (spec: lazy-loaded).
const PostComposerModal = lazy(() => import('@/components/home/PostComposerModal').then((m) => ({ default: m.PostComposerModal })))

/**
 * Home v1 (Figma t24oVt… page 02; spec 65:329): what to do today (Next step)
 * + who's new / available + a visual feed. Pulse is merged in; /pulse stays as
 * "Your activity" (H3) because old native apps link to it.
 *   1 Header: wordmark · "+" New post · Search
 *   2 Next step: one card, "1 of N" dots
 *   3 People: "New in the community" — clubs + recruiting coaches get "Available now"
 *   4 Feed (get_home_feed_v2) with "Roles for you" after the 2nd item
 */
export default function HomePage() {
  useScrollRestore()
  useDocumentTitle('Home')
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const prependItemRef = useRef<((item: HomeFeedItem) => void) | null>(null)
  const [composing, setComposing] = useState(false)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const [coachMode] = useCoachPulseMode()
  const clubSide = role === 'club' || (role === 'coach' && coachMode === 'recruit')

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
            {/* Tonal, not a second Primary: the Next step card carries the
                screen's one Primary (design audit B6). */}
            <button type="button" onClick={openComposer} className="flex h-11 shrink-0 items-center rounded-full bg-brand-soft px-5 text-[15px] font-semibold text-brand-primary transition-colors hover:bg-brand-soft-hover" data-testid="home-new-post">
              New post
            </button>
          </div>
          {/* One-time, players only; renders nothing once answered. */}
          <div className="px-4 empty:hidden">
            <FullMatchPrivacyNotice className="mt-3" />
          </div>

          <HomeV1Feed
            prependItemRef={prependItemRef}
            header={
              <>
                {/* Goal first, then the roles card, then gear and deals (Figma YG G1 / HR1, founder 2026-10-25). */}
                <GoalCard />
                <NextStepCard onCompose={openComposer} />
                <GearRail />
                <PeopleRow kind={clubSide ? 'available' : 'new'} />
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
