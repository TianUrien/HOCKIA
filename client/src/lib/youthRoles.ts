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

export const YOUTH_PLAYER_ROLE_MESSAGE = 'Player roles are for adult teams. Under-18 players can’t be recruited on Hockia.'
