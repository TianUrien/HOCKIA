/**
 * Player-oriented Settings rows (availability, "Looking for", the full-match
 * default, My applications / New roles) are for the people who get recruited:
 * players and coaches. A club flipping "Open to opportunities" there used to
 * drive its Recruiting pill (Club v2 audit 2026-09-25).
 */
export function isRecruitableRole(role: string | null | undefined): boolean {
  return role === 'player' || role === 'coach'
}
