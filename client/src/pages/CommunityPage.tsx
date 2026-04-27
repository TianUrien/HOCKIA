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
import type { CommunityTab } from '@/components/community'

const VALID_TABS: CommunityTab[] = ['all', 'players', 'coaches', 'clubs', 'umpires', 'questions']

export default function CommunityPage() {
  const { tab } = useParams<{ tab?: string }>()
  const [refreshKey, setRefreshKey] = useState(0)

  // Determine active tab from URL param — default to 'all' (open ecosystem view)
  const activeTab: CommunityTab =
    tab && VALID_TABS.includes(tab as CommunityTab)
      ? (tab as CommunityTab)
      : 'all'

  const handleRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1)
  }, [])

  const isMembers = activeTab !== 'questions'

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

        {/* Content based on active tab */}
        <div key={`${activeTab}-${refreshKey}`} className="animate-fade-in">
          {activeTab === 'all' && <PeopleListView />}
          {activeTab === 'players' && <PeopleListView roleFilter="player" />}
          {activeTab === 'coaches' && <PeopleListView roleFilter="coach" />}
          {activeTab === 'clubs' && <PeopleListView roleFilter="club" />}
          {activeTab === 'umpires' && <PeopleListView roleFilter="umpire" />}
          {activeTab === 'questions' && <QuestionsListView />}
        </div>
      </main>
      </PullToRefresh>
    </div>
  )
}
