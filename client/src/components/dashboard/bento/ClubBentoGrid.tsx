import CoachPostedOpportunitiesCard from './CoachPostedOpportunitiesCard'
import ClubBasicInfoCard from './ClubBasicInfoCard'
import ClubMembersCard from './ClubMembersCard'
import CommunityCard from './CommunityCard'
import MediaCard from './MediaCard'
import type { Profile } from '@/lib/supabase'

/**
 * ClubBentoGrid — Club-side Bento layout, mirroring CoachBentoGrid but
 * adapted to a club's organisation/recruiter nature.
 *
 * A club is an organisation, not a candidate, so the grid answers:
 *   - What is this club? (Club information + About)
 *   - What is it recruiting for? (My Posted Opportunities — owner only)
 *   - Who plays for it? (Club Members roster)
 *   - How is it represented socially? (My Network)
 *   - What does it look like? (Media)
 *
 * Differences from Coach:
 *   - No Journey card — clubs have no career-history timeline; the
 *     club_bio / club_history narrative lives inside Club information.
 *   - No "My Applications" card — clubs publish opportunities, they
 *     never apply to them.
 *   - Members card is club-specific (the roster of players/coaches who
 *     list this club on their profile).
 *
 * Owner order (readOnly=false):
 *     Club information     | My Posted Opportunities
 *     Club Members         | My Network
 *     Media (full-width)
 *
 * Visitor order (readOnly=true):
 *     Club information     | Club Members
 *     My Network           | Media
 *
 *   Visitors don't see My Posted Opportunities — that card is the
 *   owner's recruiting management surface (Create-opportunity CTA,
 *   applications count). The open opportunities themselves remain
 *   reachable via the Opportunities section route.
 */
type ClubBentoProfile = Pick<
  Profile,
  | 'id'
  | 'nationality'
  | 'nationality_country_id'
  | 'base_location'
  | 'year_founded'
  | 'website'
  | 'club_bio'
  | 'club_history'
  | 'contact_email'
  | 'contact_email_public'
  | 'email'
  | 'highlight_video_url'
  | 'full_game_video_count'
  | 'accepted_friend_count'
  | 'accepted_reference_count'
  | 'post_count'
> & {
  womens_league_division?: string | null
  mens_league_division?: string | null
}

interface ClubBentoGridProps {
  profile: ClubBentoProfile
  readOnly: boolean
  /** Section navigation — used by cards as their CTA navigation. */
  onOpenTab: (
    tab: 'profile' | 'media' | 'friends' | 'comments' | 'posts' | 'community' | 'opportunities' | 'members',
  ) => void
  /** Owner CTAs. */
  onEdit: () => void
  onCreateOpportunity: () => void
  onManageOpportunities: () => void
}

export default function ClubBentoGrid({
  profile,
  readOnly,
  onOpenTab,
  onEdit,
  onCreateOpportunity,
  onManageOpportunities,
}: ClubBentoGridProps) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5"
      data-testid={readOnly ? 'club-bento-grid-visitor' : 'club-bento-grid-owner'}
    >
      {readOnly ? (
        // Visitor order: Club information → Members → Network → Media.
        // Identity first, then roster, then social proof, then media.
        <>
          <ClubBasicInfoCard profile={profile} readOnly />
          <ClubMembersCard
            ownerProfileId={profile.id}
            onViewMembers={() => onOpenTab('members')}
          />
          <CommunityCard
            profile={profile}
            // 'references' is never emitted while hideReferences is set
            // (the tile isn't rendered) — filtered out to satisfy the
            // narrower club section union.
            onOpenTab={(tab) => {
              if (tab !== 'references') onOpenTab(tab)
            }}
            hideReferences
            readOnly={readOnly}
          />
          <MediaCard
            profile={profile}
            readOnly
            role="club"
            onManageMedia={() => onOpenTab('media')}
          />
        </>
      ) : (
        // Owner order: Club information → My Posted Opportunities →
        // Club Members → My Network → Media (full-width, last).
        <>
          <ClubBasicInfoCard profile={profile} readOnly={false} onEdit={onEdit} />
          <CoachPostedOpportunitiesCard
            ownerProfileId={profile.id}
            onCreateOpportunity={onCreateOpportunity}
            onManageOpportunities={onManageOpportunities}
            bodyCopy="Publish player and coach roles and recruit candidates. Review applications and shortlist in one place."
          />
          <ClubMembersCard
            ownerProfileId={profile.id}
            onViewMembers={() => onOpenTab('members')}
          />
          <CommunityCard
            profile={profile}
            // 'references' is never emitted while hideReferences is set
            // (the tile isn't rendered) — filtered out to satisfy the
            // narrower club section union.
            onOpenTab={(tab) => {
              if (tab !== 'references') onOpenTab(tab)
            }}
            hideReferences
            readOnly={readOnly}
          />
          <MediaCard
            profile={profile}
            readOnly={false}
            role="club"
            onManageMedia={() => onOpenTab('media')}
            fullWidth
          />
        </>
      )}
    </div>
  )
}
