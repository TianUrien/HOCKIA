import OpportunitiesCard from './OpportunitiesCard'
import BasicInfoCard from './BasicInfoCard'
import JourneyCard from './JourneyCard'
import MediaCard from './MediaCard'
import AboutMeCard from './AboutMeCard'
import CommunityCard from './CommunityCard'
import SavedCandidatesCard from './SavedCandidatesCard'
import type { Profile } from '@/lib/supabase'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

/**
 * PlayerBentoGrid — the modular dashboard layout that replaces the old
 * Profile-tab form. Owner and visitor see different card sets, but
 * share the same priority logic: identity → visual → career → social →
 * conversion CTA.
 *
 * Hero is rendered OUTSIDE this grid by PlayerDashboard so it stays at
 * the top of every view (including section deep links). The grid only
 * owns the secondary cards.
 *
 * Owner (private dashboard, readOnly=false):
 *   Basic info (+ About me) | Media
 *   Journey                 | Community
 *   Opportunities (full-width — closes the layout)
 *
 * Visitor (public profile, readOnly=true):
 *   About me | Media
 *   Journey  | Community
 *
 * About me is merged INTO BasicInfoCard for owners (to reduce card count
 * and keep "stuff you edit" in one place). Visitors keep AboutMeCard as
 * a standalone card because they don't see BasicInfoCard — those facts
 * are already on their Hero.
 *
 * Tap behaviour: each card's CTA navigates to its own section route
 * (e.g. /dashboard/profile/journey, /dashboard/profile/community). The
 * old tab strip is gone — PR2 promoted every section to a dedicated
 * route. PlayerDashboard's handler decides whether the URL is the
 * owner shape (/dashboard/profile/:section) or the visitor shape
 * (/players/:username/:section).
 */
interface PlayerBentoGridProps {
  profile: PlayerProfileShape
  readOnly: boolean
  /** Tab handler — used by cards as their CTA navigation. */
  onOpenTab: (tab: 'profile' | 'media' | 'journey' | 'references' | 'friends' | 'comments' | 'posts' | 'community') => void
  /** Owner CTAs. */
  onEdit: () => void
  onViewOpportunities: () => void
}

export default function PlayerBentoGrid({
  profile,
  readOnly,
  onOpenTab,
  onEdit,
  onViewOpportunities,
}: PlayerBentoGridProps) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5"
      data-testid={readOnly ? 'player-bento-grid-visitor' : 'player-bento-grid-owner'}
    >
      {readOnly ? (
        // Visitor order: About me (identity) → Media (visual) →
        // Journey (career) → Community (social).
        <>
          <AboutMeCard bio={profile.bio} readOnly />
          <MediaCard
            profile={profile as Pick<Profile, 'id' | 'highlight_video_url' | 'full_game_video_count'>}
            readOnly
            onManageMedia={() => onOpenTab('media')}
          />
          <JourneyCard
            profileId={profile.id}
            readOnly
            careerEntryCount={profile.career_entry_count ?? null}
            bio={profile.bio ?? null}
            onViewJourney={() => onOpenTab('journey')}
          />
          <CommunityCard
            profile={profile as Pick<Profile, 'id' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>}
            onOpenTab={onOpenTab}
            readOnly
          />
        </>
      ) : (
        // Owner order: Basic info (identity, includes About me) →
        // Media (visual) → Journey (career) → Community (social) →
        // Opportunities (conversion CTA, full-width closing row).
        // Opportunities spans both columns so it doesn't sit alone on
        // the right with a visual gap on desktop.
        <>
          <BasicInfoCard profile={profile} readOnly={false} onEdit={onEdit} />
          <MediaCard
            profile={profile as Pick<Profile, 'id' | 'highlight_video_url' | 'full_game_video_count'>}
            readOnly={false}
            onManageMedia={() => onOpenTab('media')}
          />
          <JourneyCard
            profileId={profile.id}
            readOnly={false}
            careerEntryCount={profile.career_entry_count ?? null}
            bio={profile.bio ?? null}
            onViewJourney={() => onOpenTab('journey')}
          />
          <CommunityCard
            profile={profile as Pick<Profile, 'id' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>}
            onOpenTab={onOpenTab}
          />
          {/* Saved Profiles — players save mixed profiles (clubs they're
              interested in, coaches to contact, players to follow) to
              revisit later. Same private list + /dashboard/saved page
              clubs/coaches use, but framed as "Saved Profiles" not
              "Saved Candidates". Owner-only (it's inside the
              readOnly=false branch). */}
          <SavedCandidatesCard variant="player" />
          <OpportunitiesCard
            ownerProfileId={profile.id}
            onViewOpportunities={onViewOpportunities}
            fullWidth
          />
        </>
      )}
    </div>
  )
}
