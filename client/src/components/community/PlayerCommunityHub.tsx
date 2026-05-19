import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import CommentsTab from '../CommentsTab'
import ProfilePostsTab from '../ProfilePostsTab'
import { useAuthStore } from '@/lib/auth'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { useReferenceFriendOptions } from '@/hooks/useReferenceFriendOptions'
import CredibilityNetworkCard from './CredibilityNetworkCard'
import CommunityReferencesSection from './CommunityReferencesSection'
import ConnectionsSection from './ConnectionsSection'
import type { Profile } from '@/lib/supabase'
import { trackReferenceModalOpen } from '@/lib/analytics'

/**
 * PlayerCommunityHub — owner-side Community page assembly.
 *
 * Top: CredibilityNetworkCard (stats + primary CTAs).
 * Mid: CommunityReferencesSection (selected refs → requests → given).
 *      ConnectionsSection (segmented tabs: Connections / Requests / Sent).
 * Bottom: Comments on your profile, Posts.
 *
 * The Add Reference CTA in the top card opens the AddReferenceModal owned
 * by CommunityReferencesSection (state lifted here via the addModalOpen
 * prop). Manage Friends scrolls to the ConnectionsSection.
 *
 * Visitors get PublicCommunityView, not this — the read-only view ships
 * fewer sections and uses the legacy PublicReferencesSection carousel.
 */
interface PlayerCommunityHubProps {
  profile: Pick<
    Profile,
    'id' | 'role' | 'full_name' | 'username' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'
  >
  /** Optional notification highlight IDs forwarded to CommentsTab. */
  highlightedCommentIds?: Set<string>
}

export default function PlayerCommunityHub({
  profile,
  highlightedCommentIds,
}: PlayerCommunityHubProps) {
  const navigate = useNavigate()
  const { profile: authProfile } = useAuthStore()
  const isOwner = authProfile?.id === profile.id

  const { friendOptions } = useReferenceFriendOptions(profile.id)
  const referencesState = useTrustedReferences(profile.id)
  const { acceptedCount, maxReferences, incomingRequests, canAddMore } = referencesState

  // Top-of-page count for the credibility card — uses the live RPC-driven
  // counts (acceptedCount from the hook) rather than the cached column
  // since the same hook drives the references list below and any mutation
  // there should update the header without a refetch round-trip.
  const referencesUsed = acceptedCount

  // Pending = incoming reference requests + incoming friend requests.
  // Fetch incoming friend requests once for the badge; ConnectionsSection
  // also fetches its own list for its tab badge — that's fine, it's a
  // small query and keeps each section self-contained.
  const [incomingFriendCount, setIncomingFriendCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { count, error } = await supabase
          .from('profile_friend_edges')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .eq('status', 'pending')
          .neq('requester_id', profile.id)
        if (error) throw error
        if (!cancelled) setIncomingFriendCount(count ?? 0)
      } catch (err) {
        logger.error('[PlayerCommunityHub] incoming friends count failed', err)
        if (!cancelled) setIncomingFriendCount(0)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profile.id])

  const pendingCount = incomingRequests.length + incomingFriendCount

  // Add Reference CTA — lifts modal state up here so the top card's button
  // can drive the modal owned by CommunityReferencesSection.
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [openAddForFriendId, setOpenAddForFriendId] = useState<string | null>(null)

  const handleAddReference = () => {
    if (!canAddMore) return
    trackReferenceModalOpen('credibility_card')
    setAddModalOpen(true)
  }

  const handleManageFriends = () => {
    // Scroll to the Connections section within this page; if it's already
    // visible the scroll is a no-op.
    const el = document.getElementById('community-connections')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      navigate('/dashboard/profile/friends')
    }
  }

  const handleAskToVouch = (friendId: string) => {
    setOpenAddForFriendId(friendId)
  }

  const connectionsCount = useMemo(
    () => profile.accepted_friend_count ?? 0,
    [profile.accepted_friend_count],
  )

  if (!isOwner) return null

  return (
    // pb-32 leaves enough scroll headroom so ?section=posts (the last
    // section) can anchor flush at the top of the viewport. Without this
    // the page hits max scroll before posts reaches the top — confirmed
    // by QA. Same fix applies to the visitor hub.
    <div className="space-y-4 pb-32">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">My Network</h1>
        <p className="mt-1 text-sm text-gray-600">
          Build trust through connections, references and activity.
        </p>
      </header>

      <CredibilityNetworkCard
        referencesUsed={referencesUsed}
        referencesMax={maxReferences}
        connectionsCount={connectionsCount}
        pendingCount={pendingCount}
        onAddReference={handleAddReference}
        onManageFriends={handleManageFriends}
        addReferenceDisabled={!canAddMore}
      />

      <div id="community-references" className="scroll-mt-20">
        <CommunityReferencesSection
          profileRole={profile.role}
          friendOptions={friendOptions}
          references={referencesState}
          addModalOpen={addModalOpen}
          onAddModalClose={() => setAddModalOpen(false)}
          openAddModalForFriendId={openAddForFriendId}
          onAddReferenceConsumed={() => setOpenAddForFriendId(null)}
        />
      </div>

      <div id="community-connections" className="scroll-mt-20">
        <ConnectionsSection
          profileId={profile.id}
          profileRole={profile.role}
          onAskToVouch={handleAskToVouch}
        />
      </div>

      <section
        id="community-comments"
        data-testid="community-comments-wrapper"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6 scroll-mt-20"
      >
        <CommentsTab
          profileId={profile.id}
          highlightedCommentIds={highlightedCommentIds}
          profileRole={profile.role}
        />
      </section>

      <section
        id="community-posts"
        data-testid="community-posts-wrapper"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6 scroll-mt-20"
      >
        <ProfilePostsTab profileId={profile.id} readOnly={false} />
      </section>
    </div>
  )
}
