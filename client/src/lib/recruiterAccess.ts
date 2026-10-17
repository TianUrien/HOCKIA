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

/**
 * The role a recruiting scope reshapes Community to ('player' | 'coach'), or
 * null. Only a recruiting viewer's scope reshapes anything: a candidate coach
 * (or a player) with a stale scope row gets the plain, un-reshaped page.
 */
export function recruitingScopedRole(
  profile: RecruiterAccessProfile | null | undefined,
  activeTargetRole: string | null | undefined,
  /** An active context with no sought role (a saved search: team + region)
   *  ranks and narrows PLAYERS (16 Oct 2026 — before, it reshaped nothing). */
  hasActiveScope = false,
): 'player' | 'coach' | null {
  if (!isRecruitingViewer(profile)) return null
  if (activeTargetRole === 'player' || activeTargetRole === 'coach') return activeTargetRole
  return hasActiveScope && !activeTargetRole ? 'player' : null
}
