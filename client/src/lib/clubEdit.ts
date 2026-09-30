import { clubLeadLeague } from '@/lib/clubProfileCopy'
import { contactEmailSubtitle } from '@/lib/clubSettingsCopy'

/**
 * Rules for Edit club profile (Figma 04 Club D1.27, DEV NOTE 368:1103) and the
 * club's empty Opportunities (D1.25). Same limits as the v1 club editor
 * (EditProfileModal) so both surfaces accept and refuse the same values.
 */
export const CLUB_NAME_MAX = 80
export const CLUB_BIO_MAX = 1500
/** Predates organised field hockey clubs comfortably (v1 CLUB_YEAR_MIN). */
export const CLUB_YEAR_MIN = 1850

/** Years for the Year founded picker, newest first. */
export function foundedYears(now: Date = new Date()): number[] {
  const years: number[] = []
  for (let y = now.getFullYear(); y >= CLUB_YEAR_MIN; y -= 1) years.push(y)
  return years
}

/** null = fine. Empty is allowed (the field is optional). */
export function yearFoundedError(value: string, now: Date = new Date()): string | null {
  const text = value.trim()
  if (!text) return null
  const year = Number(text)
  const max = now.getFullYear()
  if (!Number.isInteger(year) || year < CLUB_YEAR_MIN || year > max) return `Choose a year between ${CLUB_YEAR_MIN} and ${max}.`
  return null
}

/**
 * Lenient website check (v1 isValidWebsite): the scheme is optional, but the
 * host needs a dot, so "https://not-a-url" is refused.
 */
export function isValidWebsite(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return url.hostname.includes('.') && !url.hostname.startsWith('.') && !url.hostname.endsWith('.')
  } catch {
    return false
  }
}

/** "https://www.kilkennyhc.com/" → "kilkennyhc.com" for the row value. */
export function websiteLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '') || null
}

/** Club & league row: "Linked · Leinster Division 1A", "Linked", or null (not linked). */
export function clubLeagueRowValue(linked: boolean, men: string | null | undefined, women: string | null | undefined): string | null {
  if (!linked) return null
  const league = clubLeadLeague(men, women)
  return league ? `Linked · ${league}` : 'Linked'
}

/** Photos row: "2 photos" / "1 photo"; null (reads "Add") when there are none. */
export function photosRowValue(count: number | null): string | null {
  if (count === null || count <= 0) return null
  return `${count} photo${count === 1 ? '' : 's'}`
}

/** Contact email row: "Private · club@x.com" / "Shown on your profile"; empty → null ("Add"). */
export function contactRowValue(email: string | null | undefined, isPublic: boolean | null | undefined): string | null {
  return contactEmailSubtitle(email, isPublic, null)
}

/**
 * D1.25: the first-run Opportunities screen shows while the club has no role
 * at all. A saved draft counts as a role (the normal screen lists it with
 * Continue), so it never hides behind the empty state.
 */
export function isFirstRunOpportunities(loading: boolean, open: readonly unknown[], closed: readonly unknown[]): boolean {
  return !loading && open.length === 0 && closed.length === 0
}
