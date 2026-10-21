// Hockia AI · profile builder, text first (handoff P1–P3, Figma 185:378 /
// 185:452 / 185:551). The member writes their career, passports and date of
// birth in their own words; a forced tool call reads it, and everything is
// checked here before it becomes a PROPOSAL. Nothing is written by the
// server: the client saves only what the member keeps and confirms.
//
// Founder rulings 2026-10-18: players and coaches; passports only fill EMPTY
// slots (never replace); a date of birth is offered only when none is set,
// and an under-18 date is never saved from the chat.

export const TEXT_MAX = 1500
export const CAREER_MAX = 12
export const PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const

export const PROFILE_DRAFT_TOOL = {
  name: 'propose_profile',
  description: 'Read what the member wrote about their hockey career and fill these fields. Use null or [] for anything they did not say.',
  input_schema: {
    type: 'object',
    properties: {
      career: {
        type: 'array',
        description: 'Clubs and teams they played or coached for, most recent first.',
        items: {
          type: 'object',
          properties: {
            club_name: { type: 'string', description: 'The club as they wrote it, without the city.' },
            city: { type: ['string', 'null'] },
            country: { type: ['string', 'null'], description: 'Country name in English.' },
            league: { type: ['string', 'null'], description: 'League or division, e.g. "Metro A".' },
            role: { type: ['string', 'null'], description: 'Position or coaching role at that club, if said.' },
            start_year: { type: ['integer', 'null'] },
            start_month: { type: ['integer', 'null'], description: '1–12 if said.' },
            end_year: { type: ['integer', 'null'] },
            end_month: { type: ['integer', 'null'] },
            current: { type: 'boolean', description: 'true if they are there now.' },
          },
          required: ['club_name'],
        },
      },
      passports: { type: 'array', items: { type: 'string' }, description: 'Countries of their passports or nationalities, in English. Never ID numbers.' },
      date_of_birth: { type: ['string', 'null'], description: 'YYYY-MM-DD only if they gave a full date.' },
      position: { type: ['string', 'null'], enum: [...PLAYER_POSITIONS, null], description: 'Their main playing position (a left back is a defender).' },
      secondary_position: { type: ['string', 'null'], enum: [...PLAYER_POSITIONS, null] },
      photos: {
        type: 'array',
        description: 'One entry per attached photo, by its number.',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            id_document: { type: 'boolean', description: 'true if it shows a passport, ID card, driving licence or any identity document.' },
          },
          required: ['index', 'id_document'],
        },
      },
    },
    required: ['career', 'passports'],
  },
} as const

export const PROFILE_DRAFT_SYSTEM = [
  'You help a field hockey player or coach fill their Hockia profile from what they wrote.',
  'Use ONLY what they wrote. Never invent clubs, seasons, leagues, dates, passports or positions.',
  'If a detail is missing or unclear, leave it null. A missing field is fine; a guessed one is not.',
  '"2 seasons at X" after a club ending in 2022 means X from 2022 to 2024. "Since 2023" or "now" means current.',
  'Passports: country names only. Ignore any ID or passport numbers.',
  'A CV or a club page may list many things: keep only this member\'s own clubs, seasons, leagues and roles.',
  'Photos: for each one, say whether it shows an identity document. Do not describe people.',
  'Never use em dashes (—) in your answers; use a period, a colon, a comma or parentheses.',
].join('\n')

export interface CareerProposal {
  club_name: string
  city: string | null
  country: string | null
  league: string | null
  role: string | null
  start_year: number | null
  start_month: number | null
  end_year: number | null
  end_month: number | null
  current: boolean
}

export interface RawProfileDraft {
  career: CareerProposal[]
  passports: string[]
  date_of_birth: string | null
  position: string | null
  secondary_position: string | null
  /** Indexes of attached photos that show an identity document (never saved). */
  idPhotos: number[]
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const orNull = (s: string) => (s ? s : null)
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null)

/** A real calendar date in YYYY-MM-DD, else null. */
export function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null
}

/** Whole years between a birth date and today (UTC). */
export function ageOn(dob: string, today: Date): number {
  const [y, m, d] = dob.split('-').map(Number)
  let age = today.getUTCFullYear() - y
  const mm = today.getUTCMonth() + 1
  if (mm < m || (mm === m && today.getUTCDate() < d)) age -= 1
  return age
}

/** Check the model's tool input: shapes, ranges, the order of seasons. */
export function validateProfileDraft(raw: unknown, today = new Date()): RawProfileDraft {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const thisYear = today.getUTCFullYear()
  const career: CareerProposal[] = (Array.isArray(r.career) ? r.career : []).slice(0, CAREER_MAX).flatMap((c) => {
    const e = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    const club = str(e.club_name, 80)
    if (club.length < 2) return []
    let start_year = int(e.start_year, 1950, thisYear + 1)
    let end_year = int(e.end_year, 1950, thisYear + 1)
    const current = e.current === true
    if (current) end_year = null
    if (start_year && end_year && end_year < start_year) [start_year, end_year] = [end_year, start_year]
    return [{
      club_name: club,
      city: orNull(str(e.city, 60)),
      country: orNull(str(e.country, 60)),
      league: orNull(str(e.league, 80)),
      role: orNull(str(e.role, 60)),
      start_year,
      start_month: start_year ? int(e.start_month, 1, 12) : null,
      end_year,
      end_month: end_year ? int(e.end_month, 1, 12) : null,
      current,
    }]
  })
  const passports = [...new Set((Array.isArray(r.passports) ? r.passports : []).map((p) => str(p, 60)).filter((p) => p.length >= 3 && !/\d/.test(p)))].slice(0, 2)
  const pick = (v: unknown) => (typeof v === 'string' && (PLAYER_POSITIONS as readonly string[]).includes(v) ? v : null)
  const position = pick(r.position)
  const secondary = pick(r.secondary_position)
  return {
    career,
    passports,
    date_of_birth: validDate(r.date_of_birth),
    position,
    secondary_position: secondary && secondary !== position ? secondary : null,
    idPhotos: (Array.isArray(r.photos) ? r.photos : []).flatMap((p) => {
      const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
      return typeof o.index === 'number' && Number.isInteger(o.index) && o.id_document === true ? [o.index] : []
    }),
  }
}

/** Club names compared for a directory match: case, accents, punctuation and filler words don't count. */
export function normalizeClub(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['club', 'hockey', 'hc', 'cd', 'ch', 'the', 'de', 'del', 'fc', 'sc', 'ac', 'thc', 'hockeyclub'].includes(w))
    .join(' ')
}

/** "2019 – 2022", "May 2021 – Present", "2023" — the career row's years line. */
export function yearsLabel(c: CareerProposal): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const part = (y: number | null, m: number | null) => (y ? (m ? `${M[m - 1]} ${y}` : `${y}`) : '')
  const from = part(c.start_year, c.start_month)
  const to = c.current ? 'Present' : part(c.end_year, c.end_month)
  return from && to ? `${from} – ${to}` : from || to
}

/** Season dates for career_history (first of the month; January when only a year). */
export function seasonDate(y: number | null, m: number | null): string | null {
  return y ? `${y}-${String(m ?? 1).padStart(2, '0')}-01` : null
}
