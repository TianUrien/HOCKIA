import { coachSpecialtyLabel, positionLabel, roleLabel } from '@/lib/identity'

/**
 * Pure helpers behind Squad — own (Figma 04 Club D1.15, DEV NOTE 338:702).
 * The screen and its data hook live in components/club/SquadScreen.tsx and
 * hooks/useClubSquad.ts.
 */

export interface SquadPerson {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string
  position: string | null
  secondary_position: string | null
  coach_specialization: string | null
  coach_specialization_custom: string | null
}

/** DEV NOTE: rows always show the role — "Player · position" or "Coach · specialty". */
export function squadRoleLine(p: Pick<SquadPerson, 'role' | 'position' | 'secondary_position' | 'coach_specialization' | 'coach_specialization_custom'>): string {
  if (p.role === 'coach') {
    const label = coachSpecialtyLabel(p.coach_specialization, p.coach_specialization_custom)
    return [roleLabel('coach'), label].filter(Boolean).join(' · ')
  }
  const positions = [p.position, p.secondary_position]
    .filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i)
    .map((v) => positionLabel(v) ?? v)
  return [roleLabel('player'), ...positions].join(' · ')
}

/** "Kilkenny Hockey Club" → "Kilkenny" for the empty-state line (Figma D1.15). */
export function clubShortName(name: string | null | undefined): string {
  const full = name?.trim() || ''
  if (!full) return 'your club'
  const short = full.replace(/\s+(field\s+)?(hockey\s+club|hockey|hc|club)$/i, '').trim()
  return short || full
}

/** Whole years between a date of birth and now; null when unknown or invalid. */
export function ageFrom(dob: string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  let age = now.getUTCFullYear() - d.getUTCFullYear()
  const m = now.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--
  return age
}

/**
 * The invite search is a club-facing list of people, so it follows the D2
 * club-facing age rule (founder ruling 2026-09-26), the same one the server
 * enforces in invite_club_member: players need a known date of birth and 18+;
 * coaches are not age-gated (as in D2 search). A club's existing squad is
 * never filtered by age.
 */
export function isInvitable(role: string, dob: string | null | undefined, now: Date = new Date()): boolean {
  if (role !== 'player') return true
  const age = ageFrom(dob, now)
  return age !== null && age >= 18
}

export type InviteState = 'member' | 'pending' | 'invitable'

/** What the invite-search row offers: already on the squad, invitation pending, or Invite. */
export function inviteStateFor(id: string, memberIds: ReadonlySet<string>, pendingIds: ReadonlySet<string>): InviteState {
  if (memberIds.has(id)) return 'member'
  if (pendingIds.has(id)) return 'pending'
  return 'invitable'
}

/** "3 joined with this link" — DEV NOTE: shown once join_count > 0. */
export function joinCountLine(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null
  return `${count} joined with this link`
}

export { squadSettingsSubtitle, inviteErrorMessage, NOT_INVITABLE_MESSAGE } from './clubSquadCopy'
