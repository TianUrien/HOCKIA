/**
 * Key facts — the six facts a club reads first on a profile (D2 · 30-second
 * profile, Figma D2.1 club view / D2.2 owner view). Pure: callers pass the
 * data in, this decides what each tile says.
 *
 * Player: position · plays at (+ league) · available · passport (+ EU, + permit
 *         line for recruiters) · video · age.
 * Coach:  specialization · categories · current role · available · passport · age.
 *
 * Viewer modes:
 *  - 'owner'     gaps read "Not set" and carry the Add action that opens the
 *                matching editor; permits show with their status so an
 *                expiring / expired one can be drawn amber.
 *  - 'recruiter' club or recruiting coach (public.is_recruiter): gaps read
 *                "Not given"; valid permits add a second passport line.
 *  - 'public'    anyone else: gaps read "Not given"; never any permit detail.
 *
 * Founder rulings 2026-09-26 encoded here:
 *  - A league the player typed because their club has no league on Hockia is
 *    SELF-REPORTED: shown with a label, never counted for level or fit
 *    (levelBandForFit returns null for it).
 *  - Permit details are for the owner and recruiters only; a valid permit is a
 *    second passport-tile line. Permits are shown, not enforced.
 *  - EU status is derived from the passports, never typed.
 */
import { categoriesToDisplay } from '@/lib/hockeyCategories'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import { AVAILABILITY_DURATION_LABELS, isAvailabilityDuration } from '@/lib/availabilityDuration'
import { workPermitStatus, workPermitTypeLabel, type WorkPermitStatus } from '@/lib/workPermits'

export type KeyFactsViewer = 'owner' | 'recruiter' | 'public'

export type PlayerKeyFactId = 'position' | 'plays_at' | 'available' | 'passport' | 'video' | 'age'
export type CoachKeyFactId = 'specialization' | 'categories' | 'current_role' | 'available' | 'passport' | 'age'

/** Owner-only Add actions; the UI maps each to its editor. */
export type KeyFactAction =
  | 'add_position'
  | 'add_club'
  | 'add_league'
  | 'add_availability'
  | 'add_date'
  | 'add_passport'
  | 'add_video'
  | 'add_specialization'
  | 'add_categories'
  | 'add_current_role'

export interface KeyFactLine {
  text: string
  /** Set on permit lines; 'expiring_soon' / 'expired' are drawn amber (owner only). */
  status?: WorkPermitStatus
}

export interface KeyFact<Id extends string = string> {
  id: Id
  label: string
  /** Main line. When missing, the "Not given" / "Not set" copy. */
  value: string
  missing: boolean
  /** Second line (league, start date, EU yes/no …), or null. */
  detail: string | null
  /** True when `detail` is a missing sub-fact ("League not given", "No start date"). */
  detailMissing: boolean
  /** 'self_reported' when the league shown was typed by the player. */
  badge: 'self_reported' | null
  /** Extra lines under the fact (permit lines on the passport tile). */
  extraLines: KeyFactLine[]
  /** Owner only: the Add action for this gap, or null. */
  action: KeyFactAction | null
}

export interface PassportInput {
  name: string
  flag?: string | null
  isEu: boolean
}

export interface PermitInput {
  countryName: string
  flag?: string | null
  type: string
  validFrom: string | null
  /** Optional: a permit with no expiry is valid and shows no "until" date. */
  expiresOn: string | null
}

export interface LeagueInput {
  name: string
  /** 'club' = the linked world club's league (verified); 'self_reported' = typed by the player. */
  source: 'club' | 'self_reported'
  /** Only meaningful for source 'club'; ignored for self-reported leagues. */
  levelBand?: number | null
}

export interface PlayerKeyFactsInput {
  position: string | null
  secondaryPosition: string | null
  currentClubName: string | null
  league: LeagueInput | null
  availableFrom: string | null
  availabilityDuration: string | null
  passports: PassportInput[]
  permits?: PermitInput[]
  fullMatchCount: number
  highlightCount: number
  age: number | null
}

export interface CoachKeyFactsInput {
  specialization: string | null
  specializationCustom?: string | null
  categories: string[] | null
  /** e.g. "Head coach" at the current club; null when not given. */
  currentRole: string | null
  currentClubName: string | null
  openToCoach: boolean | null
  availableFrom: string | null
  availabilityDuration?: string | null
  passports: PassportInput[]
  age: number | null
}

export interface KeyFactsOptions {
  viewer: KeyFactsViewer
  today?: Date
}

export const NOT_GIVEN = 'Not given'
export const NOT_SET = 'Not set'
export const SELF_REPORTED_LABEL = 'self-reported'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clean(s: string | null | undefined): string | null {
  const t = typeof s === 'string' ? s.trim() : ''
  return t.length > 0 ? t : null
}

function parseIsoDay(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/** 'YYYY-MM-DD' → "12 Jan 2027" (UTC calendar date, no timezone drift). */
export function formatDay(iso: string | null | undefined): string | null {
  const p = parseIsoDay(iso)
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : null
}

/** 'YYYY-MM-DD' → "Mar 2027". */
export function formatMonth(iso: string | null | undefined): string | null {
  const p = parseIsoDay(iso)
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : null
}

function isOnOrBeforeToday(iso: string, today: Date): boolean {
  const p = parseIsoDay(iso)
  if (!p) return false
  const day = Date.UTC(p.y, p.m - 1, p.d)
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return day <= now
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function withFlag(name: string, flag?: string | null): string {
  const f = clean(flag)
  return f ? `${f} ${name}` : name
}

function fact<Id extends string>(id: Id, label: string, partial: Partial<KeyFact<Id>> & { value: string }): KeyFact<Id> {
  return {
    id,
    label,
    missing: false,
    detail: null,
    detailMissing: false,
    badge: null,
    extraLines: [],
    action: null,
    ...partial,
  }
}

function missingFact<Id extends string>(id: Id, label: string, viewer: KeyFactsViewer, action: KeyFactAction | null): KeyFact<Id> {
  const isOwner = viewer === 'owner'
  return fact(id, label, {
    value: isOwner ? NOT_SET : NOT_GIVEN,
    missing: true,
    action: isOwner ? action : null,
  })
}

/**
 * The level band fit/level code may use for a league. A self-reported league
 * NEVER counts (founder ruling 2026-09-26) — only the club's own league does.
 */
export function levelBandForFit(league: LeagueInput | null | undefined): number | null {
  if (!league || league.source !== 'club') return null
  return typeof league.levelBand === 'number' ? league.levelBand : null
}

/** "Midfielder · Defender" */
function positionFact(input: PlayerKeyFactsInput, viewer: KeyFactsViewer): KeyFact<PlayerKeyFactId> {
  const parts = [clean(input.position), clean(input.secondaryPosition)].filter((p): p is string => p !== null)
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
  if (unique.length === 0) return missingFact('position', 'Position', viewer, 'add_position')
  return fact('position', 'Position', { value: unique.join(' · ') })
}

function playsAtFact(input: PlayerKeyFactsInput, viewer: KeyFactsViewer): KeyFact<PlayerKeyFactId> {
  const isOwner = viewer === 'owner'
  const club = clean(input.currentClubName)
  const leagueName = input.league ? clean(input.league.name) : null
  const selfReported = input.league?.source === 'self_reported' && leagueName !== null

  if (!club && !leagueName) return missingFact('plays_at', 'Plays at', viewer, 'add_club')

  let detail: string
  let detailMissing = false
  let action: KeyFactAction | null = null
  if (leagueName) {
    detail = selfReported ? `${leagueName} · ${SELF_REPORTED_LABEL}` : leagueName
  } else {
    detail = isOwner ? 'League not set' : 'League not given'
    detailMissing = true
    action = isOwner ? 'add_league' : null
  }

  return fact('plays_at', 'Plays at', {
    // A self-reported league with no club still shows: the league is the fact.
    value: club ?? leagueName ?? '',
    detail: club ? detail : selfReported ? SELF_REPORTED_LABEL : null,
    detailMissing,
    badge: selfReported ? 'self_reported' : null,
    action,
  })
}

function availabilityLines(
  availableFrom: string | null,
  duration: string | null | undefined,
  viewer: KeyFactsViewer,
  today: Date,
): { value: string | null; detail: string | null; detailMissing: boolean; action: KeyFactAction | null } {
  const isOwner = viewer === 'owner'
  const durationLabel = isAvailabilityDuration(duration) ? AVAILABILITY_DURATION_LABELS[duration] : null
  const day = formatDay(availableFrom)
  const dateLine = day && availableFrom ? (isOnOrBeforeToday(availableFrom, today) ? 'Available now' : `From ${day}`) : null

  if (!durationLabel && !dateLine) return { value: null, detail: null, detailMissing: false, action: null }
  if (durationLabel && dateLine) return { value: durationLabel, detail: dateLine, detailMissing: false, action: null }
  if (durationLabel) {
    return {
      value: durationLabel,
      detail: isOwner ? 'No start date' : 'Start date not given',
      detailMissing: true,
      action: isOwner ? 'add_date' : null,
    }
  }
  return { value: dateLine, detail: null, detailMissing: false, action: null }
}

function passportFact<Id extends string>(
  id: Id,
  passports: PassportInput[],
  permits: PermitInput[] | undefined,
  viewer: KeyFactsViewer,
  today: Date,
): KeyFact<Id> {
  const isOwner = viewer === 'owner'
  // Max two passports (founder ruling): the profile holds two nationality fields.
  const list = passports.filter((p) => clean(p.name) !== null).slice(0, 2)

  const extraLines: KeyFactLine[] = []
  if (viewer !== 'public' && permits && permits.length > 0) {
    for (const permit of permits) {
      const status = workPermitStatus(permit.validFrom, permit.expiresOn, today)
      const valid = status === 'valid' || status === 'expiring_soon'
      // Recruiters see valid permits only; the owner sees every permit with its
      // status (amber row for expiring soon / expired).
      if (!isOwner && !valid) continue
      // No expiry → no date on the line ("🇬🇧 United Kingdom · Visa").
      const until = formatMonth(permit.expiresOn)
      const from = status === 'not_yet_valid' ? formatMonth(permit.validFrom) : null
      const when = status === 'expired'
        ? `expired ${until ?? ''}`.trim()
        : [from ? `from ${from}` : null, until ? `until ${until}` : null].filter(Boolean).join(' ') || null
      const text = [
        withFlag(permit.countryName, permit.flag),
        workPermitTypeLabel(permit.type),
        when,
      ].filter(Boolean).join(' · ')
      extraLines.push(isOwner ? { text, status } : { text })
    }
  }

  if (list.length === 0) {
    const base = missingFact(id, 'Passport', viewer, 'add_passport')
    return { ...base, extraLines }
  }

  const anyEu = list.some((p) => p.isEu)
  return fact(id, 'Passport', {
    value: list.map((p) => withFlag(p.name.trim(), p.flag)).join(' · '),
    detail: anyEu ? 'EU passport' : 'No EU passport',
    extraLines,
    // Owner with one passport: "Add another" (second passport field).
    action: isOwner && list.length < 2 ? 'add_passport' : null,
  })
}

function ageFact<Id extends string>(id: Id, age: number | null, viewer: KeyFactsViewer): KeyFact<Id> {
  if (typeof age !== 'number' || !Number.isFinite(age) || age <= 0) {
    // Date of birth is set once through the age gate; there is no Add action.
    return missingFact(id, 'Age', viewer, null)
  }
  return fact(id, 'Age', { value: String(Math.floor(age)) })
}

/** The six player key facts, in display order. */
export function buildPlayerKeyFacts(input: PlayerKeyFactsInput, options: KeyFactsOptions): KeyFact<PlayerKeyFactId>[] {
  const { viewer } = options
  const today = options.today ?? new Date()

  const avail = availabilityLines(input.availableFrom, input.availabilityDuration, viewer, today)
  const available: KeyFact<PlayerKeyFactId> = avail.value
    ? fact('available', 'Available', {
        value: avail.value,
        detail: avail.detail,
        detailMissing: avail.detailMissing,
        action: avail.action,
      })
    : missingFact('available', 'Available', viewer, 'add_availability')

  const fm = Math.max(0, Math.floor(input.fullMatchCount || 0))
  const hl = Math.max(0, Math.floor(input.highlightCount || 0))
  const videoParts = [
    fm > 0 ? plural(fm, 'full match', 'full matches') : null,
    hl > 0 ? plural(hl, 'highlight', 'highlights') : null,
  ].filter((p): p is string => p !== null)
  const video: KeyFact<PlayerKeyFactId> = videoParts.length > 0
    ? fact('video', 'Video', { value: videoParts.join(' · ') })
    : missingFact('video', 'Video', viewer, 'add_video')

  return [
    positionFact(input, viewer),
    playsAtFact(input, viewer),
    available,
    passportFact('passport', input.passports, input.permits, viewer, today),
    video,
    ageFact('age', input.age, viewer),
  ]
}

/** The six coach key facts, in display order. */
export function buildCoachKeyFacts(input: CoachKeyFactsInput, options: KeyFactsOptions): KeyFact<CoachKeyFactId>[] {
  const { viewer } = options
  const today = options.today ?? new Date()

  const specialization = clean(input.specialization)
    ? fact('specialization', 'Specialization', {
        value: getSpecializationLabel(input.specialization, input.specializationCustom),
      })
    : missingFact('specialization', 'Specialization', viewer, 'add_specialization')

  const categoriesText = categoriesToDisplay(input.categories)
  const categories = categoriesText
    ? fact('categories', 'Categories', { value: categoriesText })
    : missingFact('categories', 'Categories', viewer, 'add_categories')

  const role = clean(input.currentRole)
  const club = clean(input.currentClubName)
  const currentRole = role || club
    ? fact('current_role', 'Current role', { value: role ?? club ?? '', detail: role && club ? club : null })
    : missingFact('current_role', 'Current role', viewer, 'add_current_role')

  const avail = availabilityLines(input.availableFrom, input.availabilityDuration ?? null, viewer, today)
  let available: KeyFact<CoachKeyFactId>
  if (avail.value) {
    available = fact('available', 'Available', {
      value: avail.value,
      detail: avail.detail,
      detailMissing: avail.detailMissing,
      action: avail.action,
    })
  } else if (input.openToCoach === true) {
    available = fact('available', 'Available', {
      value: 'Open to coach',
      detail: viewer === 'owner' ? 'No start date' : 'Start date not given',
      detailMissing: true,
      action: viewer === 'owner' ? 'add_date' : null,
    })
  } else {
    available = missingFact('available', 'Available', viewer, 'add_availability')
  }

  return [
    specialization,
    categories,
    currentRole,
    available,
    // Visas & permits are a player table; coaches show the passport line only.
    passportFact('passport', input.passports, undefined, viewer, today),
    ageFact('age', input.age, viewer),
  ]
}

/** How many of the facts are filled — feeds the owner's "Clubs see these six first" nudge. */
export function countFilledKeyFacts(facts: readonly KeyFact[]): number {
  return facts.filter((f) => !f.missing).length
}
