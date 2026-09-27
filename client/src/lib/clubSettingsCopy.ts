import { clubLeadLeague } from '@/lib/clubProfileCopy'

/**
 * Settings — club (Figma D1.22 353:893; DEV NOTE 355:927): identity row,
 * the Club group (Club & league · Squad & invites · Contact email) and its
 * footnote.
 */

/** Edit club profile. Leaf 10 builds the v2 screen; this is the existing
 *  entry point that opens the club's profile editor today. */
export const CLUB_EDIT_PATH = '/dashboard/profile?action=edit'

export const CLUB_GROUP_FOOTER = 'Your league and crest show on your roles and profile. Recruiting lives in Opportunities.'

/** "Linked · Leinster Division 1A" / "Not linked yet · link your club" (same as the own profile). */
export function clubLeagueSubtitle(p: { current_world_club_id?: string | null; mens_league_division?: string | null; womens_league_division?: string | null }): string {
  if (!p.current_world_club_id) return 'Not linked yet · link your club'
  return `Linked · ${clubLeadLeague(p.mens_league_division, p.womens_league_division) ?? 'league not set'}`
}

/** "Private · players message you on Hockia" (default) / "Public · club@x.com". */
export function contactEmailSubtitle(email: string | null | undefined, isPublic: boolean | null | undefined): string {
  const e = email?.trim()
  if (e && isPublic) return `Public · ${e}`
  if (e) return `Private · ${e}`
  return 'Private · players message you on Hockia'
}

export function isValidContactEmail(value: string): boolean {
  const v = value.trim()
  return v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}
