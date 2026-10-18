// Club speed CS1–CS2 · "Start with Hockia AI" (Figma 05 204:892 / 204:981).
// The club writes one sentence; the model fills the structured fields of
// Post a role steps 1–3 through a forced tool call, and everything it returns
// is checked here against the same vocabularies the form offers. Anything
// unknown is dropped (left "Not set"), never guessed. Location is NOT drafted:
// the form fills it from the club profile. Kept in _shared so the deno test
// suite covers it.

export const PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
export const COACH_POSITIONS = [
  'head_coach', 'assistant_coach', 'youth_coach', 'goalkeeper_coach',
  'strength_conditioning', 'performance_analyst', 'sports_scientist', 'other_coach',
] as const
export const PLAYER_TEAMS = ['Men', 'Women', 'Mixed'] as const
export const COACH_TEAMS = ['Men', 'Women', 'Mixed', 'Boys', 'Girls'] as const
export const LEVELS = ['competitive', 'high_performance', 'elite'] as const
export const PAY = ['paid', 'unpaid_development', 'either'] as const
export const PACKAGE = ['housing', 'flights', 'insurance', 'job', 'car', 'visa', 'bonuses', 'equipment'] as const
// Mirrors client/src/lib/postRole.ts SKILLS; sweeper_keeper is goalkeeper-only.
export const SKILLS = [
  'drag_flicker', 'penalty_corner', 'defensive_leader', 'target_forward', 'pressing', 'playmaker', 'indoor', 'sweeper_keeper',
] as const
export const DURATIONS = [
  '1 month', ...Array.from({ length: 11 }, (_, i) => `${i + 2} months`), 'Full season', 'Permanent',
] as const

export const TEXT_MAX = 500
export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 2000

export interface RoleDraftFromText {
  type: 'player' | 'coach'
  position: string | null
  team: string | null
  title: string
  level: string | null
  skills: string[]
  startDate: string | null
  duration: string | null
  pay: string | null
  package: string[]
  euPassport: boolean
  description: string
}

/** The forced tool the model fills. Enums mirror the form; every field may be null. */
export const ROLE_DRAFT_TOOL = {
  name: 'fill_role',
  description: 'Fill the Post a role form from what the club wrote. Use null for anything the club did not say.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['player', 'coach'], description: 'player unless the club is looking for a coach or staff member' },
      position: { type: ['string', 'null'], enum: [...PLAYER_POSITIONS, ...COACH_POSITIONS, null], description: 'Player line (a left back is a defender) or the coaching role' },
      team: { type: ['string', 'null'], enum: [...COACH_TEAMS, null], description: 'Men, Women, Mixed; Boys or Girls only for a coach role' },
      title: { type: ['string', 'null'], description: 'Short role title in the club\'s words, e.g. "Left back" or "Head coach, women\'s 1st team". No club name.' },
      level: { type: ['string', 'null'], enum: [...LEVELS, null] },
      skills: { type: 'array', items: { type: 'string', enum: [...SKILLS] } },
      start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD. A month alone means its 1st day, in the future.' },
      duration: { type: ['string', 'null'], enum: [...DURATIONS, null] },
      pay: { type: ['string', 'null'], enum: [...PAY, null] },
      package: { type: 'array', items: { type: 'string', enum: [...PACKAGE] } },
      eu_passport: { type: ['boolean', 'null'], description: 'true only when the club asks for an EU passport' },
      description: { type: ['string', 'null'], description: '"About the role": 3–5 short sentences as the club ("we"), only facts the club gave.' },
    },
    required: ['type'],
  },
} as const

export const ROLE_DRAFT_SYSTEM = [
  'You help a field hockey club post a role on Hockia by filling the form from what the club wrote.',
  'Use ONLY what the club wrote. Never invent pay, housing, dates, level, skills, training days or promises.',
  'Leave a field null when the club did not say it. A missing field is fine; a guessed one is not.',
  'Players: goalkeeper, defender (full back, centre back, left/right back, sweeper), midfielder, forward (striker, winger).',
  'Under-18 player roles do not exist: a player role is Men, Women or Mixed only.',
  'The description is "About the role": first person plural, warm and plain, 3–5 short sentences, under 600 characters, no emoji, no placeholders.',
].join('\n')

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null
const pickAll = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))] : []

/** YYYY-MM-DD between today and two years ahead (the deadline rule's window), else null. */
export function validStart(v: unknown, today: Date): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null
  const min = today.toISOString().slice(0, 10)
  const maxD = new Date(today); maxD.setUTCFullYear(maxD.getUTCFullYear() + 2)
  return v >= min && v <= maxD.toISOString().slice(0, 10) ? v : null
}

/** Check the model's tool input against the form's vocabularies. */
export function validateRoleDraft(raw: unknown, today = new Date()): RoleDraftFromText {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const type = r.type === 'coach' ? 'coach' : 'player'
  const position = pick(r.position, type === 'player' ? PLAYER_POSITIONS : COACH_POSITIONS)
  const team = pick(r.team, type === 'player' ? PLAYER_TEAMS : COACH_TEAMS)
  const description = str(r.description, DESCRIPTION_MAX)
  return {
    type,
    position,
    team,
    title: str(r.title, TITLE_MAX),
    level: type === 'player' ? pick(r.level, LEVELS) : null,
    skills: type === 'player' ? pickAll(r.skills, SKILLS).filter((s) => s !== 'sweeper_keeper' || position === 'goalkeeper') : [],
    startDate: validStart(r.start_date, today),
    duration: pick(r.duration, DURATIONS),
    pay: pick(r.pay, PAY),
    package: pickAll(r.package, PACKAGE),
    euPassport: r.eu_passport === true,
    // Same no-placeholder rule as "Draft it with Hockia AI".
    description: /[[\]{}]|_{2,}|\bTBD\b|\bXX+\b/i.test(description) ? '' : description,
  }
}

/** The club's sentence, cleaned and capped. Empty → nothing to draft. */
export function cleanRoleText(v: unknown): string {
  return str(v, TEXT_MAX)
}
