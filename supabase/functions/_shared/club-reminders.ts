/**
 * B2 · Club reminders — the pure rules (no I/O, no Deno globals, no URL
 * imports: send-push/push-payload.ts imports the copy helpers and the client's
 * vitest imports push-payload.ts).
 *
 * Founder spec: Figma New-Hockia Backlog 406:19, schedule 386:618, rulings of
 * 9 Oct 2026. The server owns the data and the idempotency
 * (club_reminder_candidates / club_reminder_claim, migration
 * 20261009100000_b2_club_reminders.sql); this file decides, per publisher:
 *
 *   - WHEN: reminder emails at 09:00 in the publisher's country timezone, at
 *     most one per local day; pushes never between 22:00 and 08:00 local.
 *   - WHAT: Last call (1 day left) and Closing soon (4 days left) items, the
 *     Closing-soon skip rule, and combining both into one email.
 *   - THE WORDS: subjects, push titles and bodies (first names only, never a
 *     pronoun).
 *
 * The edge function `club-reminders` runs it; tests sit in club-reminders.test.ts.
 */

// ── Timezones ────────────────────────────────────────────────────────────────

/**
 * One representative IANA timezone per country code in public.countries
 * (ISO alpha-2, plus the UK constituents GB-ENG / GB-SCT / GB-WLS / GB-NIR and
 * the legacy England code XE). Countries spanning several zones use the zone
 * of their main hockey population (US → New York, AU → Sydney, BR → São Paulo,
 * CA → Toronto, RU → Moscow). Unknown or missing → UTC.
 */
export const COUNTRY_TIMEZONES: Readonly<Record<string, string>> = {
  // Europe
  AD: 'Europe/Andorra', AL: 'Europe/Tirane', AT: 'Europe/Vienna', BA: 'Europe/Sarajevo',
  BE: 'Europe/Brussels', BG: 'Europe/Sofia', BY: 'Europe/Minsk', CH: 'Europe/Zurich',
  CY: 'Asia/Nicosia', CZ: 'Europe/Prague', DE: 'Europe/Berlin', DK: 'Europe/Copenhagen',
  EE: 'Europe/Tallinn', ES: 'Europe/Madrid', FI: 'Europe/Helsinki', FR: 'Europe/Paris',
  GB: 'Europe/London', 'GB-ENG': 'Europe/London', 'GB-SCT': 'Europe/London',
  'GB-WLS': 'Europe/London', 'GB-NIR': 'Europe/London', XE: 'Europe/London',
  GR: 'Europe/Athens', HR: 'Europe/Zagreb', HU: 'Europe/Budapest', IE: 'Europe/Dublin',
  IS: 'Atlantic/Reykjavik', IT: 'Europe/Rome', LI: 'Europe/Vaduz', LT: 'Europe/Vilnius',
  LU: 'Europe/Luxembourg', LV: 'Europe/Riga', MC: 'Europe/Monaco', MD: 'Europe/Chisinau',
  ME: 'Europe/Podgorica', MK: 'Europe/Skopje', MT: 'Europe/Malta', NL: 'Europe/Amsterdam',
  NO: 'Europe/Oslo', PL: 'Europe/Warsaw', PT: 'Europe/Lisbon', RO: 'Europe/Bucharest',
  RS: 'Europe/Belgrade', RU: 'Europe/Moscow', SE: 'Europe/Stockholm', SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava', SM: 'Europe/San_Marino', TR: 'Europe/Istanbul', UA: 'Europe/Kyiv',
  VA: 'Europe/Vatican', XK: 'Europe/Belgrade',
  // South America
  AR: 'America/Argentina/Buenos_Aires', BO: 'America/La_Paz', BR: 'America/Sao_Paulo',
  CL: 'America/Santiago', CO: 'America/Bogota', EC: 'America/Guayaquil', GY: 'America/Guyana',
  PE: 'America/Lima', PY: 'America/Asuncion', SR: 'America/Paramaribo', UY: 'America/Montevideo',
  VE: 'America/Caracas',
  // North and Central America, Caribbean
  CA: 'America/Toronto', MX: 'America/Mexico_City', US: 'America/New_York',
  BZ: 'America/Belize', CR: 'America/Costa_Rica', SV: 'America/El_Salvador',
  GT: 'America/Guatemala', HN: 'America/Tegucigalpa', NI: 'America/Managua', PA: 'America/Panama',
  AG: 'America/Antigua', BS: 'America/Nassau', BB: 'America/Barbados', CU: 'America/Havana',
  DM: 'America/Dominica', DO: 'America/Santo_Domingo', GD: 'America/Grenada',
  HT: 'America/Port-au-Prince', JM: 'America/Jamaica', KN: 'America/St_Kitts',
  LC: 'America/St_Lucia', VC: 'America/St_Vincent', TT: 'America/Port_of_Spain',
  PR: 'America/Puerto_Rico',
  // Africa
  DZ: 'Africa/Algiers', AO: 'Africa/Luanda', BJ: 'Africa/Porto-Novo', BW: 'Africa/Gaborone',
  BF: 'Africa/Ouagadougou', BI: 'Africa/Bujumbura', CV: 'Atlantic/Cape_Verde',
  CM: 'Africa/Douala', CF: 'Africa/Bangui', TD: 'Africa/Ndjamena', KM: 'Indian/Comoro',
  CG: 'Africa/Brazzaville', CD: 'Africa/Kinshasa', DJ: 'Africa/Djibouti', EG: 'Africa/Cairo',
  GQ: 'Africa/Malabo', ER: 'Africa/Asmara', SZ: 'Africa/Mbabane', ET: 'Africa/Addis_Ababa',
  GA: 'Africa/Libreville', GM: 'Africa/Banjul', GH: 'Africa/Accra', GN: 'Africa/Conakry',
  GW: 'Africa/Bissau', CI: 'Africa/Abidjan', KE: 'Africa/Nairobi', LS: 'Africa/Maseru',
  LR: 'Africa/Monrovia', LY: 'Africa/Tripoli', MG: 'Indian/Antananarivo', MW: 'Africa/Blantyre',
  ML: 'Africa/Bamako', MR: 'Africa/Nouakchott', MU: 'Indian/Mauritius', MA: 'Africa/Casablanca',
  MZ: 'Africa/Maputo', NA: 'Africa/Windhoek', NE: 'Africa/Niamey', NG: 'Africa/Lagos',
  RW: 'Africa/Kigali', ST: 'Africa/Sao_Tome', SN: 'Africa/Dakar', SC: 'Indian/Mahe',
  SL: 'Africa/Freetown', SO: 'Africa/Mogadishu', ZA: 'Africa/Johannesburg', SS: 'Africa/Juba',
  SD: 'Africa/Khartoum', TZ: 'Africa/Dar_es_Salaam', TG: 'Africa/Lome', TN: 'Africa/Tunis',
  UG: 'Africa/Kampala', ZM: 'Africa/Lusaka', ZW: 'Africa/Harare',
  // Asia
  AF: 'Asia/Kabul', AM: 'Asia/Yerevan', AZ: 'Asia/Baku', BH: 'Asia/Bahrain', BD: 'Asia/Dhaka',
  BT: 'Asia/Thimphu', BN: 'Asia/Brunei', KH: 'Asia/Phnom_Penh', CN: 'Asia/Shanghai',
  GE: 'Asia/Tbilisi', IN: 'Asia/Kolkata', ID: 'Asia/Jakarta', IR: 'Asia/Tehran', IQ: 'Asia/Baghdad',
  IL: 'Asia/Jerusalem', JP: 'Asia/Tokyo', JO: 'Asia/Amman', KZ: 'Asia/Almaty', KW: 'Asia/Kuwait',
  KG: 'Asia/Bishkek', LA: 'Asia/Vientiane', LB: 'Asia/Beirut', MY: 'Asia/Kuala_Lumpur',
  MV: 'Indian/Maldives', MN: 'Asia/Ulaanbaatar', MM: 'Asia/Yangon', NP: 'Asia/Kathmandu',
  KP: 'Asia/Pyongyang', OM: 'Asia/Muscat', PK: 'Asia/Karachi', PS: 'Asia/Hebron',
  PH: 'Asia/Manila', QA: 'Asia/Qatar', SA: 'Asia/Riyadh', SG: 'Asia/Singapore', KR: 'Asia/Seoul',
  LK: 'Asia/Colombo', SY: 'Asia/Damascus', TW: 'Asia/Taipei', TJ: 'Asia/Dushanbe',
  TH: 'Asia/Bangkok', TL: 'Asia/Dili', TM: 'Asia/Ashgabat', AE: 'Asia/Dubai',
  UZ: 'Asia/Tashkent', VN: 'Asia/Ho_Chi_Minh', YE: 'Asia/Aden',
  // Oceania
  AU: 'Australia/Sydney', FJ: 'Pacific/Fiji', KI: 'Pacific/Tarawa', MH: 'Pacific/Majuro',
  FM: 'Pacific/Pohnpei', NR: 'Pacific/Nauru', NZ: 'Pacific/Auckland', PW: 'Pacific/Palau',
  PG: 'Pacific/Port_Moresby', WS: 'Pacific/Apia', SB: 'Pacific/Guadalcanal',
  TO: 'Pacific/Tongatapu', TV: 'Pacific/Funafuti', VU: 'Pacific/Efate',
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The publisher's timezone from their country code; UTC when unknown. */
export function timezoneForCountry(code: string | null | undefined): string {
  const key = typeof code === 'string' ? code.trim().toUpperCase() : ''
  const tz = key ? COUNTRY_TIMEZONES[key] : undefined
  return tz && isValidTimezone(tz) ? tz : 'UTC'
}

export interface LocalParts {
  /** YYYY-MM-DD in that timezone. */
  date: string
  hour: number
  minute: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  day: number
  month: number
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Wall-clock parts of an instant in a timezone (DST-aware, via Intl). */
export function localParts(instant: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value
  const hour = Number(parts.hour) % 24
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    day: Number(parts.day),
    month: Number(parts.month),
  }
}

/** Whole calendar days from local date `from` to local date `to` (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

// ── Schedule ─────────────────────────────────────────────────────────────────

/** Reminder emails go out in the 09:00–09:59 local hour (ruling 9 Oct). */
export const REMINDER_HOUR = 9
/** No push from 22:00 to 07:59 local; deferred pushes go at 08:00. */
export const QUIET_START_HOUR = 22
export const QUIET_END_HOUR = 8

export function isReminderHour(local: Pick<LocalParts, 'hour'>): boolean {
  return local.hour === REMINDER_HOUR
}

export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

/**
 * When a push may go: `now` outside quiet hours, else the next 08:00 local.
 * Walks quarter-hour steps so half- and quarter-hour zones (India, Nepal)
 * land on their own 08:00.
 */
export function nextPushTime(now: Date, tz: string): Date {
  if (!isQuietHour(localParts(now, tz).hour)) return now
  const step = 15 * 60_000
  const start = Math.ceil(now.getTime() / step) * step
  for (let t = start; t <= start + 27 * 3_600_000; t += step) {
    const p = localParts(new Date(t), tz)
    if (p.hour === QUIET_END_HOUR && p.minute === 0) return new Date(t)
  }
  return new Date(start + 24 * 3_600_000)
}

// ── Candidate rows (club_reminder_candidates) ────────────────────────────────

export type FitState = 'green' | 'yellow' | 'grey' | null

export interface CandidateRow {
  publisher_id: string
  publisher_email: string | null
  publisher_full_name: string | null
  publisher_role: string | null
  publisher_country_code: string | null
  publisher_notify_applications: boolean | null
  answered_last_24h: boolean | null
  last_reminder_email_date: string | null
  last_reminder_push_date: string | null
  last_new_applications_email_at: string | null
  application_id: string
  opportunity_id: string
  role_title: string | null
  role_position: string | null
  org_name: string | null
  applicant_id: string
  applicant_full_name: string | null
  applicant_avatar_url: string | null
  applicant_role: string | null
  applicant_position: string | null
  applicant_country: string | null
  applicant_is_blocked: boolean | null
  applicant_frozen_minor_at: string | null
  applicant_known_minor: boolean | null
  applied_at: string
  closes_at: string | null
  fit_state: string | null
  email_closing_soon_logged: boolean | null
  email_last_call_logged: boolean | null
  push_closing_soon_logged: boolean | null
  push_last_call_logged: boolean | null
}

/**
 * The hidden-profile fence, re-applied at the edge (the SQL already filters):
 * banned or frozen people, and known minors, never appear in a row or a count.
 * Mirrors public.profile_is_hidden + the known-minor half of profile_is_adult.
 */
export function isVisibleApplicant(row: Pick<CandidateRow, 'applicant_is_blocked' | 'applicant_frozen_minor_at' | 'applicant_known_minor'>): boolean {
  if (row.applicant_is_blocked) return false
  if (row.applicant_frozen_minor_at !== null && row.applicant_frozen_minor_at !== undefined) return false
  if (row.applicant_known_minor) return false
  return true
}

/** Item windows in local days left before the application closes on its own. */
export const CLOSING_SOON_MAX_DAYS = 4 // day 10 of 14
export const CLOSING_SOON_MIN_DAYS = 2
export const LAST_CALL_MAX_DAYS = 1 // day 13 of 14
/** "Closes <day>" chips are amber only when five days or fewer are left. */
export const AMBER_MAX_DAYS = 5

export interface ApplicantItem {
  applicationId: string
  opportunityId: string
  roleTitle: string
  orgName: string | null
  applicantId: string
  applicantName: string
  firstName: string | null
  avatarUrl: string | null
  roleLine: string
  /** False for a coach applying to a coach role (copy says "applicants"). */
  isPlayer: boolean
  fit: 'strong' | 'possible' | null
  appliedAt: string
  appliedLocal: LocalParts
}

export interface ReminderItem extends ApplicantItem {
  closesAt: string
  /** Local calendar days until it closes (0 = today, 1 = tomorrow). */
  daysLeft: number
  closesLocal: LocalParts
}

const POSITION_LABELS: Record<string, string> = {
  goalkeeper: 'Goalkeeper', defender: 'Defender', midfielder: 'Midfielder', forward: 'Forward',
  head_coach: 'Head coach', assistant_coach: 'Assistant coach', youth_coach: 'Youth coach',
  goalkeeper_coach: 'Goalkeeper coach', strength_conditioning: 'Strength & conditioning',
  performance_analyst: 'Performance analyst', sports_scientist: 'Sports scientist', other_coach: 'Coach',
}

/** 'head_coach' → 'Head coach' (mirrors _shared/display-labels positionLabel). */
export function positionText(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null
  const v = value.trim()
  const hit = POSITION_LABELS[v.toLowerCase()]
  if (hit) return hit
  const words = v.replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "Player · Midfielder · Argentina" (client lib/clubRecruiting personRoleLine + country). */
export function roleLine(role: string | null, position: string | null, country: string | null): string {
  const roleWord = role === 'coach' ? 'Coach' : role === 'umpire' ? 'Umpire' : 'Player'
  return [roleWord, positionText(position), country?.trim() || null].filter(Boolean).join(' · ')
}

/** First name only (gender-neutral copy uses the name, never a pronoun). */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = typeof fullName === 'string' ? fullName.trim().split(/\s+/)[0] : ''
  return first ? first : null
}

/** compute_club_fit levels: green → Strong, yellow → Possible, anything else → no badge. */
export function fitOf(state: string | null | undefined): 'strong' | 'possible' | null {
  return state === 'green' ? 'strong' : state === 'yellow' ? 'possible' : null
}

function applicantItem(r: CandidateRow, tz: string): ApplicantItem {
  return {
    applicationId: r.application_id,
    opportunityId: r.opportunity_id,
    roleTitle: r.role_title?.trim() || positionText(r.role_position) || 'your role',
    orgName: r.org_name?.trim() || null,
    applicantId: r.applicant_id,
    applicantName: r.applicant_full_name?.trim() || 'An applicant',
    firstName: firstNameOf(r.applicant_full_name),
    avatarUrl: r.applicant_avatar_url,
    roleLine: roleLine(r.applicant_role, r.applicant_position, r.applicant_country),
    isPlayer: r.applicant_role !== 'coach',
    fit: fitOf(r.fit_state),
    appliedAt: r.applied_at,
    appliedLocal: localParts(new Date(r.applied_at), tz),
  }
}

/** New-application rows → visible items, oldest application first. */
export function toApplicantItems(rows: CandidateRow[], tz: string): ApplicantItem[] {
  const seen = new Set<string>()
  const items: ApplicantItem[] = []
  for (const r of rows) {
    if (!isVisibleApplicant(r) || seen.has(r.application_id)) continue
    seen.add(r.application_id)
    items.push(applicantItem(r, tz))
  }
  return items.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))
}

/** Reminder rows → visible pending items, soonest-closing first. Hidden people
 *  are dropped here, so they are in neither the rows nor any "N players" count. */
export function toItems(rows: CandidateRow[], tz: string, now: Date): ReminderItem[] {
  const today = localParts(now, tz).date
  const seen = new Set<string>()
  const items: ReminderItem[] = []
  for (const r of rows) {
    if (!isVisibleApplicant(r) || !r.closes_at || seen.has(r.application_id)) continue
    seen.add(r.application_id)
    const closesLocal = localParts(new Date(r.closes_at), tz)
    const daysLeft = daysBetween(today, closesLocal.date)
    if (daysLeft < 0) continue
    items.push({ ...applicantItem(r, tz), closesAt: r.closes_at, daysLeft, closesLocal })
  }
  return items.sort((a, b) => a.closesAt.localeCompare(b.closesAt) || a.appliedAt.localeCompare(b.appliedAt))
}

/**
 * Closing-soon skip rule (spec): skip day 10 when the publisher answered any
 * application in the last 24 h AND nothing closes within 2 days.
 */
export function shouldSkipClosingSoon(answeredLast24h: boolean, items: Pick<ReminderItem, 'daysLeft'>[]): boolean {
  if (!answeredLast24h) return false
  return !items.some((i) => i.daysLeft <= 2)
}

export type ItemKind = 'last_call' | 'closing_soon'
export interface PlannedItem { applicationId: string; kind: ItemKind }

export interface PublisherReminderPlan {
  publisherId: string
  tz: string
  localDate: string
  localHour: number
  /** Every visible pending application of this publisher, soonest first. */
  pending: ReminderItem[]
  /** Closing soon items the skip rule drops today (logged as skipped, both channels). */
  skippedClosingSoon: ReminderItem[]
  /** ONE email: Last call items first, then Closing soon. */
  email: { lastCall: ReminderItem[]; closingSoon: ReminderItem[]; items: PlannedItem[] } | null
  /** ONE push: the Last call one when any is due (more urgent), else Closing soon. */
  push: { kind: ClubReminderKind; lastCall: ReminderItem[]; items: PlannedItem[] } | null
}

/**
 * The day's plan for one publisher.
 *   Email: only in the 09:00 local hour, only when none went today, only with
 *   notify_applications on and an address.
 *   Push: one per local day, at the reminder hour (with the email). A push
 *   left over from an earlier day may go from 08:00; never in quiet hours
 *   (22:00–07:59), so a due push waits for 08:00.
 *   Day-10 and day-13 content combine into ONE email (Last call first).
 */
export function planPublisherReminders(rows: CandidateRow[], now: Date): PublisherReminderPlan | null {
  if (rows.length === 0) return null
  const head = rows[0]
  const tz = timezoneForCountry(head.publisher_country_code)
  const local = localParts(now, tz)
  const pending = toItems(rows, tz, now)
  const flags = new Map(rows.map((r) => [r.application_id, r]))

  const inLastCall = (i: ReminderItem) => i.daysLeft <= LAST_CALL_MAX_DAYS
  const inClosingSoon = (i: ReminderItem) => i.daysLeft >= CLOSING_SOON_MIN_DAYS && i.daysLeft <= CLOSING_SOON_MAX_DAYS

  const lastCallEmail = pending.filter((i) => inLastCall(i) && !flags.get(i.applicationId)?.email_last_call_logged)
  const closingEmail = pending.filter((i) => inClosingSoon(i) && !flags.get(i.applicationId)?.email_closing_soon_logged)
  const lastCallPush = pending.filter((i) => inLastCall(i) && !flags.get(i.applicationId)?.push_last_call_logged)
  const closingPush = pending.filter((i) => inClosingSoon(i) && !flags.get(i.applicationId)?.push_closing_soon_logged)

  const atReminderHour = isReminderHour(local)
  // The skip rule is decided once, in the reminder hour, for both channels.
  const skip = atReminderHour && (closingEmail.length > 0 || closingPush.length > 0) &&
    shouldSkipClosingSoon(Boolean(head.answered_last_24h), pending)
  const skippedIds = new Set<string>()
  if (skip) for (const i of [...closingEmail, ...closingPush]) skippedIds.add(i.applicationId)
  const skippedClosingSoon = pending.filter((i) => skippedIds.has(i.applicationId))
  const closingSoon = closingEmail.filter((i) => !skippedIds.has(i.applicationId))
  const closingPushToday = closingPush.filter((i) => !skippedIds.has(i.applicationId))

  let email: PublisherReminderPlan['email'] = null
  const emailAllowed = atReminderHour &&
    head.last_reminder_email_date !== local.date &&
    head.publisher_notify_applications !== false &&
    Boolean(head.publisher_email?.trim())
  if (emailAllowed && (lastCallEmail.length > 0 || closingSoon.length > 0)) {
    email = {
      lastCall: lastCallEmail,
      closingSoon,
      items: [
        ...lastCallEmail.map((i) => ({ applicationId: i.applicationId, kind: 'last_call' as const })),
        ...closingSoon.map((i) => ({ applicationId: i.applicationId, kind: 'closing_soon' as const })),
      ],
    }
  }

  let push: PublisherReminderPlan['push'] = null
  // Left over = entered its window on an earlier day and was never pushed.
  const leftover = lastCallPush.some((i) => i.daysLeft < LAST_CALL_MAX_DAYS) ||
    closingPushToday.some((i) => i.daysLeft < CLOSING_SOON_MAX_DAYS)
  const pushHourOk = !isQuietHour(local.hour) && (local.hour >= REMINDER_HOUR || leftover)
  if (pushHourOk && head.last_reminder_push_date !== local.date && (lastCallPush.length > 0 || closingPushToday.length > 0)) {
    push = {
      kind: lastCallPush.length > 0 ? 'applicant_last_call' : 'applicants_closing_soon',
      lastCall: lastCallPush,
      items: [
        ...lastCallPush.map((i) => ({ applicationId: i.applicationId, kind: 'last_call' as const })),
        ...closingPushToday.map((i) => ({ applicationId: i.applicationId, kind: 'closing_soon' as const })),
      ],
    }
  }

  return { publisherId: head.publisher_id, tz, localDate: local.date, localHour: local.hour, pending, skippedClosingSoon, email, push }
}

export function groupByPublisher<T extends { publisher_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const list = out.get(r.publisher_id)
    if (list) list.push(r)
    else out.set(r.publisher_id, [r])
  }
  return out
}

// ── New-application batches ──────────────────────────────────────────────────

/** At most one new-applications email per publisher per hour. */
export const NEW_APPLICATIONS_MIN_GAP_MS = 60 * 60_000

export function newApplicationsDue(lastSentAt: string | null | undefined, now: Date): boolean {
  if (!lastSentAt) return true
  const t = Date.parse(lastSentAt)
  return Number.isNaN(t) || now.getTime() - t >= NEW_APPLICATIONS_MIN_GAP_MS
}

// ── Copy ─────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function weekdayName(local: Pick<LocalParts, 'weekday'>): string {
  return WEEKDAYS[local.weekday] ?? 'Monday'
}

/** "2 Oct" — day first, the app-wide short date. */
export function shortDate(local: Pick<LocalParts, 'day' | 'month'>): string {
  return `${local.day} ${MONTHS[local.month - 1] ?? ''}`.trim()
}

/** "today" · "tomorrow" · "on Friday" · "on 14 Oct". */
export function closesPhrase(daysLeft: number, closesLocal: Pick<LocalParts, 'weekday' | 'day' | 'month'>): string {
  if (daysLeft <= 0) return 'today'
  if (daysLeft === 1) return 'tomorrow'
  if (daysLeft <= 6) return `on ${weekdayName(closesLocal)}`
  return `on ${shortDate(closesLocal)}`
}

/** Chip text: "Closes today" · "Closes tomorrow" · "Closes Friday" · "Closes 14 Oct". */
export function closesChip(daysLeft: number, closesLocal: Pick<LocalParts, 'weekday' | 'day' | 'month'>): string {
  const p = closesPhrase(daysLeft, closesLocal)
  return `Closes ${p.startsWith('on ') ? p.slice(3) : p}`
}

export function chipIsAmber(daysLeft: number): boolean {
  return daysLeft <= AMBER_MAX_DAYS
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** "player"/"players", or "applicant(s)" when a coach role is in the list. */
export function peopleNoun(n: number, allPlayers: boolean): string {
  return allPlayers ? plural(n, 'player', 'players') : plural(n, 'applicant', 'applicants')
}

/** "Ana" · "Ana and Ben" · "Ana and 2 more" (no first name → "an applicant"). */
export function namesPhrase(firstNames: (string | null)[]): string {
  const names = firstNames.map((n) => n ?? null)
  const first = names[0] ?? 'an applicant'
  if (names.length <= 1) return first
  if (names.length === 2) return `${first} and ${names[1] ?? 'one more'}`
  return `${first} and ${names.length - 1} more`
}

/** Day 13 subject: "Last day to answer Ana" (grouped: "… Ana and Ben" / "… Ana and 2 more"). */
export function lastCallSubject(items: Pick<ReminderItem, 'firstName'>[]): string {
  return `Last day to answer ${namesPhrase(items.map((i) => i.firstName))}`
}

/** Day 13 paragraph, per application. */
export function lastCallBody(item: Pick<ReminderItem, 'firstName' | 'daysLeft' | 'appliedLocal'>): string {
  const name = item.firstName ?? 'This applicant'
  const who = item.firstName ?? 'the applicant'
  const when = item.daysLeft <= 0 ? 'Today' : 'Tomorrow'
  return `${name} applied on ${shortDate(item.appliedLocal)}. ${when} the application closes on its own and ${who} is told you didn't reply. A short answer either way is better than none.`
}

/** Day 10 subject: "Ana's application closes on Friday" (one) / "3 players are waiting for your answer". */
export function closingSoonSubject(pending: Pick<ReminderItem, 'firstName' | 'daysLeft' | 'closesLocal'>[], allPlayers = true): string {
  if (pending.length === 1) {
    const i = pending[0]
    const owner = i.firstName ? `${i.firstName}'s application` : 'An application'
    return `${owner} closes ${closesPhrase(i.daysLeft, i.closesLocal)}`
  }
  return waitingLine(pending.length, allPlayers)
}

/** "3 players are waiting for your answer" / "1 player is waiting for your answer". */
export function waitingLine(n: number, allPlayers = true): string {
  return `${n} ${peopleNoun(n, allPlayers)} ${plural(n, 'is', 'are')} waiting for your answer`
}

export const DECLINE_HINT = 'Not the right fit? Declining takes one tap, and Hockia AI drafts a kind note you can edit.'
export const SETTINGS_FOOTER = 'Change emails in Settings → Notifications.'

/** New-applications batch subject. */
export function newApplicationsSubject(items: Pick<ApplicantItem, 'firstName' | 'roleTitle' | 'opportunityId'>[]): string {
  const roles = new Set(items.map((i) => i.opportunityId))
  if (items.length === 1) {
    const i = items[0]
    return `${i.firstName ?? 'Someone'} applied for ${i.roleTitle}`
  }
  return roles.size === 1 ? `${items.length} new applicants for ${items[0].roleTitle}` : `${items.length} new applicants for your roles`
}

// ── Links (in-app paths; the email prefixes the site URL) ────────────────────

export function reviewPath(opportunityId: string, applicationId: string): string {
  return `/dashboard/opportunities/${encodeURIComponent(opportunityId)}/applicants/${encodeURIComponent(applicationId)}`
}

export function applicantsPath(opportunityId: string): string {
  return `/dashboard/opportunities/${encodeURIComponent(opportunityId)}/applicants`
}

export const OPPORTUNITIES_PATH = '/opportunities'

/** Where "Review" goes: the applicant (one), the role's Applicants (one role), or Opportunities. */
export function reviewTarget(items: Pick<ApplicantItem, 'opportunityId' | 'applicationId'>[]): string {
  if (items.length === 1) return reviewPath(items[0].opportunityId, items[0].applicationId)
  const roles = new Set(items.map((i) => i.opportunityId))
  if (roles.size === 1) return applicantsPath(items[0].opportunityId)
  return OPPORTUNITIES_PATH
}

export function declinePath(opportunityId: string, applicationId: string): string {
  return `${reviewPath(opportunityId, applicationId)}?decline=1`
}

// ── Push / in-app notification copy ──────────────────────────────────────────

export type ClubReminderKind = 'applicant_last_call' | 'applicants_closing_soon'

export interface ClubReminderNotification {
  kind: ClubReminderKind
  title: string
  summary: string
  target_url: string
  metadata: Record<string, unknown>
}

/**
 * The bell + push for a publisher's reminder.
 *   Day 13: "Last day to answer Ana" · "The application to <role> closes tomorrow."
 *   Day 10: "3 players are waiting for <club>" · "Ana's application closes on Friday."
 * Tap: the applicant (one), the role's Applicants (one role), else Opportunities.
 */
export function buildReminderNotification(
  kind: ClubReminderKind,
  lastCall: ReminderItem[],
  pending: ReminderItem[],
): ClubReminderNotification {
  if (kind === 'applicant_last_call') {
    const items = lastCall
    const first = items[0]
    const single = items.length === 1
    const title = `Last day to answer ${namesPhrase(items.map((i) => i.firstName))}`
    const when = first && first.daysLeft <= 0 ? 'today' : 'tomorrow'
    const summary = single
      ? `The application to ${first.roleTitle} closes ${when}.`
      : `Their applications close ${when}.`
    const target = reviewTarget(items)
    return {
      kind, title, summary, target_url: target,
      metadata: {
        title, summary, target_url: target,
        count: items.length,
        first_name: first?.firstName ?? null,
        role_title: single ? first?.roleTitle ?? null : null,
        ...singleIds(items),
      },
    }
  }
  const items = pending
  const first = items[0]
  const allPlayers = items.every((i) => i.isPlayer)
  const org = first?.orgName ?? null
  const n = items.length
  const title = org
    ? `${n} ${peopleNoun(n, allPlayers)} ${plural(n, 'is', 'are')} waiting for ${org}`
    : waitingLine(n, allPlayers)
  const summary = first
    ? `${first.firstName ? `${first.firstName}'s application` : 'An application'} closes ${closesPhrase(first.daysLeft, first.closesLocal)}.`
    : 'Applications are waiting for your answer.'
  const target = reviewTarget(items)
  return {
    kind, title, summary, target_url: target,
    metadata: {
      title, summary, target_url: target,
      count: n,
      first_name: first?.firstName ?? null,
      org_name: org,
      ...singleIds(items),
    },
  }
}

/** opportunity_id only when one role; application_id only when one applicant. */
function singleIds(items: Pick<ApplicantItem, 'opportunityId' | 'applicationId'>[]): Record<string, string> {
  const out: Record<string, string> = {}
  const roles = new Set(items.map((i) => i.opportunityId))
  if (roles.size === 1 && items[0]) out.opportunity_id = items[0].opportunityId
  if (items.length === 1) out.application_id = items[0].applicationId
  return out
}

/**
 * Route for a reminder notification from its metadata (push and in-app row
 * agree; mirrored in client components/notifications/config.ts).
 */
export function reminderRouteFromMetadata(metadata: Record<string, unknown> | null | undefined): string {
  const opp = typeof metadata?.opportunity_id === 'string' ? metadata.opportunity_id : null
  const app = typeof metadata?.application_id === 'string' ? metadata.application_id : null
  if (opp && app) return reviewPath(opp, app)
  if (opp) return applicantsPath(opp)
  return OPPORTUNITIES_PATH
}

/** Push/in-app copy for a stored reminder notification; never empty. */
export function reminderCopyFromMetadata(kind: string, metadata: Record<string, unknown> | null | undefined): { title: string; body: string } {
  const title = typeof metadata?.title === 'string' && metadata.title.trim() ? metadata.title : null
  const body = typeof metadata?.summary === 'string' && metadata.summary.trim() ? metadata.summary : null
  if (kind === 'applicant_last_call') {
    return { title: title ?? 'Last day to answer an applicant', body: body ?? 'An application closes tomorrow.' }
  }
  return { title: title ?? 'Players are waiting for your answer', body: body ?? 'Some applications close soon.' }
}
