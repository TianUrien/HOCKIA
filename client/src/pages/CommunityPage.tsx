/**
 * CommunityPage
 *
 * Container page for the Community section with two tabs:
 * - Members: Unified directory of players, coaches, clubs, and umpires.
 *   (Brands moved out to /marketplace as the canonical brand-discovery surface.)
 * - Questions: Q&A for sharing knowledge
 */

import { useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Header } from '@/components'
import { PullToRefresh } from '@/components/PullToRefresh'
import {
  CommunityTabSwitcher,
  CommunityRoleChips,
  PeopleListView,
  QuestionsListView,
} from '@/components/community'
import { TopCommunityMembersCarousel } from '@/components/community/TopCommunityMembersCarousel'
import type { CommunityTab } from '@/components/community'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

const VALID_TABS: CommunityTab[] = ['all', 'players', 'coaches', 'clubs', 'umpires', 'questions']

const TITLE_BY_TAB: Record<CommunityTab, string> = {
  all: 'Community',
  players: 'Players',
  coaches: 'Coaches',
  clubs: 'Clubs',
  umpires: 'Umpires',
  questions: 'Questions',
}

export default function CommunityPage() {
  const { tab } = useParams<{ tab?: string }>()
  const [refreshKey, setRefreshKey] = useState(0)

  // Determine active tab from URL param — default to 'all' (open ecosystem view)
  const activeTab: CommunityTab =
    tab && VALID_TABS.includes(tab as CommunityTab)
      ? (tab as CommunityTab)
      : 'all'

  useDocumentTitle(TITLE_BY_TAB[activeTab])

  const handleRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1)
  }, [])

  const isMembers = activeTab !== 'questions'

  // Map the chip tab id to the RPC's role filter. 'all' → undefined so
  // the carousel returns top across all roles (excludes brand per IA).
  const carouselRoleFilter: 'player' | 'coach' | 'club' | 'umpire' | undefined =
    activeTab === 'players'
      ? 'player'
      : activeTab === 'coaches'
        ? 'coach'
        : activeTab === 'clubs'
          ? 'club'
          : activeTab === 'umpires'
            ? 'umpire'
            : undefined

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <Header />

      <PullToRefresh onRefresh={handleRefresh}>
      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-20 pb-12">
        {/* Hero Section — trimmed for the compact grid redesign */}
        <div className="text-center mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 sm:mb-4">
            <span className="bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-transparent bg-clip-text italic">
              Community
            </span>
          </h1>

          <CommunityTabSwitcher activeTab={activeTab} />
        </div>

        {/* Role chip subnav (members-only) */}
        {isMembers && (
          <div className="mb-4 sm:mb-5">
            <CommunityRoleChips activeTab={activeTab} />
          </div>
        )}

        {/* Top community members carousel — only on Members modes, not
            Questions. Refreshes when role chip changes (key) so the
            carousel re-fetches with the new role filter. */}
        {isMembers && (
          <TopCommunityMembersCarousel
            key={`top-${activeTab}-${refreshKey}`}
            roleFilter={carouselRoleFilter}
            viewAllAnchorId="community-all-members"
          />
        )}

        {/* Content based on active tab */}
        <div key={`${activeTab}-${refreshKey}`} className="animate-fade-in">
          {isMembers ? (
            // Anchor id picked up by the carousel's "View all" scroll.
            // Wraps the list so the user lands on the All members
            // section header rather than the search bar.
            <div id="community-all-members" className="scroll-mt-20">
              {activeTab === 'all' && <PeopleListView />}
              {activeTab === 'players' && <PeopleListView roleFilter="player" />}
              {activeTab === 'coaches' && <PeopleListView roleFilter="coach" />}
              {activeTab === 'clubs' && <PeopleListView roleFilter="club" />}
              {activeTab === 'umpires' && <PeopleListView roleFilter="umpire" />}
            </div>
          ) : (
            <QuestionsListView />
          )}
        </div>
      </main>
      </PullToRefresh>
    </div>
  )
}
