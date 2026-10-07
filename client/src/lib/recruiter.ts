/**
 * Who counts as a recruiter for recruiters-only videos: a club, or a coach
 * who recruits for their team (coach_recruits_for_team). Mirrors the SQL
 * public.is_recruiter(uid), which is the real gate (RLS + the
 * video-playback-token function); this is only for UI copy and lock icons.
 * Hidden (banned / frozen) viewers are excluded server-side.
 */
export type RecruiterCandidate = {
  role?: string | null
  coach_recruits_for_team?: boolean | null
} | null | undefined

export function isRecruiterProfile(profile: RecruiterCandidate): boolean {
  if (!profile) return false
  return profile.role === 'club' || (profile.role === 'coach' && profile.coach_recruits_for_team === true)
}

export type FullMatchVisibility = 'recruiters' | 'public'

/** The player's master switch; anything unknown reads as the private default. */
export function fullMatchVisibilityOf(profile: { full_match_visibility?: string | null } | null | undefined): FullMatchVisibility {
  return profile?.full_match_visibility === 'public' ? 'public' : 'recruiters'
}

/**
 * The legacy linked highlight (profiles.highlight_video_url) honours the
 * owner's "Recruiters only" switch (profiles.highlight_visibility). Same rule
 * as the desktop MediaTab `canViewVideo`: the owner always sees it; when it
 * is public everyone does; when it is recruiters-only, only recruiters do.
 * Anything other than 'recruiters' reads as public, as the desktop does.
 * Release audit 2026-10-05: the phone profile and Videos screens rendered the
 * link without this check.
 */
export function canViewLinkedHighlight(args: {
  owner: boolean
  profile: { highlight_visibility?: string | null } | null | undefined
  viewer: RecruiterCandidate
}): boolean {
  if (args.owner) return true
  if (args.profile?.highlight_visibility !== 'recruiters') return true
  return isRecruiterProfile(args.viewer)
}
