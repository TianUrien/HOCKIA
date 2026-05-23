import CoachPostedOpportunitiesCard from './CoachPostedOpportunitiesCard'
import CoachApplicationsCard from './CoachApplicationsCard'
import BasicInfoCard from './BasicInfoCard'
import JourneyCard from './JourneyCard'
import MediaCard from './MediaCard'
import AboutMeCard from './AboutMeCard'
import CommunityCard from './CommunityCard'
import type { Profile } from '@/lib/supabase'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

/**
 * CoachBentoGrid — Coach-side Bento layout, mirroring PlayerBentoGrid
 * but adapted to the dual nature of the coach marketplace role.
 * Hero is rendered OUTSIDE this grid by CoachDashboard.
 *
 * Coaches operate on BOTH sides of the opportunities marketplace:
 *   - they publish opportunities and recruit players (My Posted
 *     Opportunities card)
 *   - they apply to opportunities posted by clubs / other coaches
 *     (My Applications card)
 *
 * Keeping these two flows in separate cards (rather than mashing them
 * into one "Opportunities" surface) makes the dashboard's mental
 * model immediate: each card has one job, one CTA, one identity.
 *
 * Owner order (readOnly=false):
 *     Basic info (+ About me)   | My Posted Opportunities
 *     My Network                | Journey
 *     Media (full-width)
 *     My Applications (full-width — last)
 *
 *   My Applications sits at the bottom because applying is a
 *   secondary coach action — most coaches use the dashboard to
 *   publish and recruit. Browsing opportunities sits below the
 *   profile content so it doesn't pull focus from the
 *   identity/network surfaces above.
 *
 * Visitor order (readOnly=true):
 *     About me | Community
 *     Journey  | Media
 *
 *   Visitors don't see Opportunities or Applications — those are the
 *   coach's owner-side recruiting + candidate surfaces.
 */
interface CoachBentoGridProps {
  profile: PlayerProfileShape
  readOnly: boolean
  /** Tab handler — used by cards as their CTA navigation. Coach uses
   *  the same tab/section vocabulary as Player, with 'opportunities'
   *  for opportunities management. */
  onOpenTab: (
    tab:
      | 'profile'
      | 'media'
      | 'journey'
      | 'references'
      | 'friends'
      | 'comments'
      | 'posts'
      | 'community'
      | 'opportunities',
  ) => void
  /** Owner CTAs. */
  onEdit: () => void
  onCreateOpportunity: () => void
  onManageOpportunities: () => void
  onBrowseOpportunities: () => void
  onViewApplications: () => void
}

export default function CoachBentoGrid({
  profile,
  readOnly,
  onOpenTab,
  onEdit,
  onCreateOpportunity,
  onManageOpportunities,
  onBrowseOpportunities,
  onViewApplications,
}: CoachBentoGridProps) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5"
      data-testid={readOnly ? 'coach-bento-grid-visitor' : 'coach-bento-grid-owner'}
    >
      {readOnly ? (
        // Visitor order: About me → Community → Journey → Media.
        // Identity first, then social proof (network), then career,
        // then supporting media. Opportunities/Recruiting are
        // owner-only.
        <>
          <AboutMeCard bio={profile.bio} readOnly />
          <CommunityCard
            profile={profile as Pick<Profile, 'id' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>}
            onOpenTab={(tab) => onOpenTab(tab)}
          />
          <JourneyCard
            profileId={profile.id}
            readOnly
            role="coach"
            bio={profile.bio ?? null}
            onViewJourney={() => onOpenTab('journey')}
          />
          <MediaCard
            profile={profile as Pick<Profile, 'id' | 'highlight_video_url' | 'full_game_video_count'>}
            readOnly
            role="coach"
            onManageMedia={() => onOpenTab('media')}
          />
        </>
      ) : (
        // Owner order: Basic info → My Posted Opportunities →
        // Community → Journey → Media → My Applications (last).
        <>
          <BasicInfoCard profile={profile} readOnly={false} onEdit={onEdit} />
          <CoachPostedOpportunitiesCard
            ownerProfileId={profile.id}
            onCreateOpportunity={onCreateOpportunity}
            onManageOpportunities={onManageOpportunities}
          />
          <CommunityCard
            profile={profile as Pick<Profile, 'id' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>}
            onOpenTab={(tab) => onOpenTab(tab)}
          />
          <JourneyCard
            profileId={profile.id}
            readOnly={false}
            role="coach"
            bio={profile.bio ?? null}
            onViewJourney={() => onOpenTab('journey')}
          />
          <MediaCard
            profile={profile as Pick<Profile, 'id' | 'highlight_video_url' | 'full_game_video_count'>}
            readOnly={false}
            role="coach"
            onManageMedia={() => onOpenTab('media')}
            fullWidth
          />
          <CoachApplicationsCard
            ownerProfileId={profile.id}
            onBrowseOpportunities={onBrowseOpportunities}
            onViewApplications={onViewApplications}
            fullWidth
          />
        </>
      )}
    </div>
  )
}
