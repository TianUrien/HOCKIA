/**
 * React Query key factory — the single vocabulary for query keys.
 *
 * Part of the requestCache → React Query migration (2026-07-29, maturity
 * roadmap #2). requestCache keys were ad-hoc template strings scattered
 * across 28 files, which is how three role-specific strength hooks ended up
 * with three different keys for the IDENTICAL gallery-count query (the
 * "shared round trip" their comments promised never actually happened).
 *
 * Rules:
 *  - Every key lives here. No inline `['foo', id]` literals at call sites.
 *  - Arrays, coarse→fine: ['domain', 'entity', id, ...params].
 *  - Invalidate by prefix: `queryClient.invalidateQueries({ queryKey:
 *    qk.galleryCount(id) })` or a broader prefix for a whole domain.
 */

export const qk = {
  /** gallery_photos count for a profile — shared by every strength hook
   *  (player/coach/umpire) and MediaCard's player/coach tile. */
  galleryCount: (profileId: string | null) => ['gallery', 'count', profileId] as const,
  /** club_media count for a club profile (MediaCard's club tile). */
  clubMediaCount: (clubId: string | null) => ['club-media', 'count', clubId] as const,
  /** career_history entry counts grouped by entry_type (JourneyCard). */
  journeyCounts: (profileId: string | null) => ['journey', 'counts', profileId] as const,
  /** Visible profile_comments count (CommunityCard). */
  commentCount: (profileId: string | null) => ['comments', 'count', profileId] as const,
  /** Player's active opportunity_applications count (OpportunitiesCard). */
  activeApplications: (profileId: string | null) =>
    ['applications', 'active-count', profileId] as const,
  /** Club member count via get_club_members RPC (ClubMembersCard). */
  clubMemberCount: (clubId: string | null) => ['club-members', 'count', clubId] as const,
  /** Recruiter's saved_profiles count + 3 most recent (SavedCandidatesCard). */
  savedCandidates: (userId: string | null) => ['saved-candidates', 'card', userId] as const,
  /** Coach applied/shortlisted application counts (CoachApplicationsCard). */
  coachApplicationCounts: (profileId: string | null) =>
    ['applications', 'coach-counts', profileId] as const,
  /** Coach's open opportunities + applicant totals (CoachPostedOpportunitiesCard). */
  coachPostedOpportunities: (profileId: string | null) =>
    ['opportunities', 'coach-posted', profileId] as const,
}
