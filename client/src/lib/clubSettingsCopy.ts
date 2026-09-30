import { clubLeadLeague } from '@/lib/clubProfileCopy'

/**
 * Settings — club (Figma D1.22 353:893; DEV NOTE 355:927): identity row,
 * the Club group (Club & league · Squad & invites · Contact email) and its
 * footnote.
 */

/** Edit club profile (D1.27). On desktop / non-club the route redirects to the old editor. */
export const CLUB_EDIT_PATH = '/dashboard/club/edit'

export const CLUB_GROUP_FOOTER = 'Your league and crest show on your roles and profile. Recruiting lives in Opportunities.'

/** "Linked · Leinster Division 1A" / "Not linked yet · link your club" (same as the own profile). */
export function clubLeagueSubtitle(p: { current_world_club_id?: string | null; mens_league_division?: string | null; womens_league_division?: string | null }): string {
  if (!p.current_world_club_id) return 'Not linked yet · link your club'
  return `Linked · ${clubLeadLeague(p.mens_league_division, p.womens_league_division) ?? 'league not set'}`
}

/** Contact email copy shared by Settings › Contact email and Edit profile
 *  (founder QA round 9): one switch label + help, one subtitle rule. */
export const CONTACT_EMAIL_SWITCH_LABEL = 'Show on your profile'
export const CONTACT_EMAIL_SWITCH_HELP = 'Off: players message you on Hockia.'

/** "Private · club@x.com" / "Shown on your profile"; empty → `empty`
 *  (Settings: "Private · players message you on Hockia"; Edit profile: null → "Add"). */
export function contactEmailSubtitle(email: string | null | undefined, isPublic: boolean | null | undefined): string
export function contactEmailSubtitle<E>(email: string | null | undefined, isPublic: boolean | null | undefined, empty: E): string | E
export function contactEmailSubtitle(email: string | null | undefined, isPublic: boolean | null | undefined, empty: unknown = 'Private · players message you on Hockia'): unknown {
  const e = email?.trim()
  if (!e) return empty
  return isPublic ? 'Shown on your profile' : `Private · ${e}`
}

export function isValidContactEmail(value: string): boolean {
  const v = value.trim()
  return v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}
