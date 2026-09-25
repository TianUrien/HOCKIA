/**
 * Who counts as a recruiter for viewer-gated UI (founder rulings 2026-09-25).
 *
 * Players and coaches applying for roles never see fit/match language,
 * applicant counts, level pills or reply-time estimates, and have no Save.
 * Save (saved_profiles / shortlists) belongs to clubs and to coaches who
 * recruit for a team (`coach_recruits_for_team`). A coach who only looks
 * for a role is a candidate, not a recruiter.
 */
export interface RecruiterAccessProfile {
  role?: string | null
  coach_recruits_for_team?: boolean | null
}

/** Clubs, and coaches who recruit for a team. */
export function isRecruitingViewer(profile: RecruiterAccessProfile | null | undefined): boolean {
  if (!profile) return false
  if (profile.role === 'club') return true
  return profile.role === 'coach' && profile.coach_recruits_for_team === true
}
