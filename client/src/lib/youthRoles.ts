import { tClub } from '@/i18n/ns/club'

/**
 * Founder ruling 2026-09-25 (C): under-18s are never recruitable, so a PLAYER
 * role can't target a youth team (Boys / Girls). The values stay valid for
 * coach/staff roles. The database enforces the same rule
 * (CHECK opportunities_player_role_not_youth, migration 20260926130000).
 */
export const YOUTH_GENDERS = ['Boys', 'Girls'] as const

export function isYouthGender(gender: string | null | undefined): boolean {
  return gender === 'Boys' || gender === 'Girls'
}

/** A player role's team, or null when it names a youth team (never valid for players). */
export function playerRoleGender<T extends string>(gender: T | null | undefined): T | null {
  if (!gender || isYouthGender(gender)) return null
  return gender
}

/** Shown when a player role names a youth team, in the interface language. */
export function youthPlayerRoleMessage(): string {
  return tClub('youthRoles.playerRoleMessage')
}

/** Hint under the Team picker on a coach role (Boys/Girls are offered there only), in the interface language. */
export function coachTeamHint(): string {
  return tClub('youthRoles.coachTeamHint')
}

/**
 * English only, kept for callers not yet translated (CreateOpportunityModal).
 * New code reads youthPlayerRoleMessage() / coachTeamHint().
 * @deprecated
 */
export const YOUTH_PLAYER_ROLE_MESSAGE = 'Player opportunities are for adult teams. Under-18 players can’t be recruited on Hockia.'

/** @deprecated English only; use coachTeamHint(). */
export const COACH_TEAM_HINT = 'Boys and Girls are for coach and staff opportunities only.'
