/**
 * Coach v2 (Figma D6 105:2): a coach is two people in one account — a
 * candidate looking for a coaching role (player rules: no match scores, no
 * counts of other applicants, no Save) and, when they recruit for their
 * team, a recruiter with the Club v2 toolset. Pure helpers for the phone
 * Opportunities screen (D6.2 Roles 377:614, D6.4 My roles 377:1814).
 */
import { applicationStatusPill } from '@/lib/opportunityCopy'
import { dayFirst } from '@/lib/dayFirst'

export interface CoachModeProfile {
  role?: string | null
  coach_recruits_for_team?: boolean | null
}

/** A coach who is only looking for a role: Roles lists coaching roles only. */
export function isCandidateCoach(profile: CoachModeProfile | null | undefined): boolean {
  return profile?.role === 'coach' && profile.coach_recruits_for_team !== true
}

/** A coach who recruits for their team: gets "My roles" next to Roles. */
export function isRecruitingCoach(profile: CoachModeProfile | null | undefined): boolean {
  return profile?.role === 'coach' && profile.coach_recruits_for_team === true
}

/** "Coaching roles · 0 open" — the line over the candidate's list. */
export function coachingRolesOpenLine(open: number): string {
  return `Coaching roles · ${open} open`
}

/**
 * "4 coaching roles were posted on Hockia this year" — null (line hidden)
 * when the count could not be read or is 0.
 */
export function coachingRolesPostedLine(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null
  return count === 1
    ? '1 coaching role was posted on Hockia this year'
    : `${count} coaching roles were posted on Hockia this year`
}

/** The first instant of `now`'s calendar year (UTC), for the "this year" count. */
export function startOfYearIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
}

export interface ClosedCoachingRole {
  id: string
  title: string
  clubName: string | null
  country: string | null
  closedAt: string | null
}

/** "Hockey Club Concordia 1906 · Croatia" */
export function closedRoleMeta(role: Pick<ClosedCoachingRole, 'clubName' | 'country'>): string {
  return [role.clubName, role.country].map((s) => s?.trim()).filter(Boolean).join(' · ')
}

/** "Closed 3 Oct" (day first; the year once it differs from now's). */
export function closedRoleDate(closedAt: string | null, now = new Date()): string | null {
  const day = dayFirst(closedAt, { now })
  return day ? `Closed ${day}` : null
}

/**
 * The coach's own status on a closed role they applied to, in the
 * player-side words (No reply / Not selected / Role closed …). Always drawn
 * grey: the role is closed, so there is nothing left for the coach to act on.
 */
export function closedRoleOwnStatus(status: string | null | undefined): string | null {
  if (!status) return null
  return applicationStatusPill(status, null, false).label
}

/** "Recruiting for Barnes HC" — the linked world club, else the typed club. */
export function recruitingForLine(worldClubName: string | null | undefined, currentClub: string | null | undefined): string | null {
  const name = worldClubName?.trim() || currentClub?.trim() || null
  return name ? `Recruiting for ${name}` : null
}
