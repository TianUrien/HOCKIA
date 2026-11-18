import { clubLeadLeague } from '@/lib/clubProfileCopy'
import { tClub } from '@/i18n/ns/club'

/**
 * Settings — club (Figma D1.22 353:893; DEV NOTE 355:927): identity row,
 * the Club group (Club & league · Squad & invites · Contact email) and its
 * footnote.
 */

/** Edit club profile (D1.27). On desktop / non-club the route redirects to the old editor. */
export const CLUB_EDIT_PATH = '/dashboard/club/edit'

/** English only, kept for callers outside the club area (Settings); new code calls `clubGroupFooter()`. */
export const CLUB_GROUP_FOOTER = 'Your league and crest show on your opportunities and profile. Recruiting lives in Opportunities.'
export const clubGroupFooter = (): string => tClub('clubSettings.groupFooter')

/** "Linked · Leinster Division 1A" / "Not linked yet · link your club" (same as the own profile). */
export function clubLeagueSubtitle(p: { current_world_club_id?: string | null; mens_league_division?: string | null; womens_league_division?: string | null }): string {
  if (!p.current_world_club_id) return tClub('clubSettings.notLinked')
  const league = clubLeadLeague(p.mens_league_division, p.womens_league_division)
  return league ? tClub('clubSettings.linkedLeague', { league }) : tClub('clubSettings.linkedNoLeague')
}

/** Contact email copy shared by Settings › Contact email and Edit profile
 *  (founder QA round 9): one switch label + help, one subtitle rule. */
/* The three constants are English only, kept for callers outside the club
 * area (Settings) and their tests; club screens call the getters below. */
export const CONTACT_EMAIL_INTRO = 'So players and coaches can reach the club directly. Your sign-in email is never shown.'
export const CONTACT_EMAIL_SWITCH_LABEL = 'Show on your profile'
export const CONTACT_EMAIL_SWITCH_HELP = 'Off: players message you on Hockia.'
export const contactEmailIntro = (): string => tClub('clubSettings.contactIntro')
export const contactEmailSwitchLabel = (): string => tClub('clubSettings.contactSwitchLabel')
export const contactEmailSwitchHelp = (): string => tClub('clubSettings.contactSwitchHelp')

/** "Private · club@x.com" / "Shown on your profile · club@x.com"; empty → `empty`
 *  (Settings: "Private · players message you on Hockia"; Edit profile: null → "Add"). */
export function contactEmailSubtitle(email: string | null | undefined, isPublic: boolean | null | undefined): string
export function contactEmailSubtitle<E>(email: string | null | undefined, isPublic: boolean | null | undefined, empty: E): string | E
export function contactEmailSubtitle(email: string | null | undefined, isPublic: boolean | null | undefined, empty: unknown = tClub('clubSettings.contactEmpty')): unknown {
  const e = email?.trim()
  if (!e) return empty
  return isPublic ? tClub('clubSettings.contactShown', { email: e }) : tClub('clubSettings.contactPrivate', { email: e })
}

export function isValidContactEmail(value: string): boolean {
  const v = value.trim()
  return v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}
