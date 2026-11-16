// Copy helpers for role-description-draft ("Draft it with Hockia AI").
// Kept here, not in the function's index.ts, so the deno test suite in
// _shared covers the grammar and the no-placeholder rule.

import { spanishPositionLabel } from './member-language.ts'
import { withOutputLanguage, type MemberLanguage } from './ai-language.ts'

export type Answers = {
  type?: string
  position?: string | null
  team?: string | null
  title?: string | null
  level?: string | null
  skills?: string[]
  start?: string | null
  duration?: string | null
  city?: string | null
  country?: string | null
  pay?: string | null
  package?: string[]
  euPassport?: boolean
}

/** Most entries kept from each list answer (skills, package) sent to the model. */
export const ANSWER_LIST_CAP = 12

/**
 * Normalise the client's answers: list answers become string arrays of at
 * most ANSWER_LIST_CAP entries (anything else is dropped), so a malformed or
 * oversized body can neither break the copy helpers nor inflate the prompt.
 */
export function sanitizeAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const a = { ...(raw as Record<string, unknown>) } as Answers & Record<string, unknown>
  const list = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, ANSWER_LIST_CAP) : undefined
  a.skills = list(a.skills)
  a.package = list(a.package)
  a.euPassport = a.euPassport === true
  return a
}

export const clean = (s: unknown, max = 80) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')
export const human = (s: string) => s.replace(/_/g, ' ')

const POSITION_WORDS: Record<string, string> = {
  strength_conditioning: 'strength & conditioning coach',
  performance_analyst: 'performance analyst',
  sports_scientist: 'sports scientist',
  other_coach: 'coach',
}

/** "midfielder", "head coach" — the role noun, lower case. */
export function roleNoun(a: Answers): string {
  const raw = clean(a.position).toLowerCase()
  if (!raw) return a.type === 'coach' ? 'coach' : 'player'
  return POSITION_WORDS[raw] ?? human(raw)
}

/** "men's team", "girls' team" — accepts the enum ("Men") or the pill label ("Men's"). */
export function teamPhrase(team: unknown): string | null {
  const t = clean(team).toLowerCase().replace(/[’']s?$/, '').replace(/[’']/g, '')
  switch (t) {
    case 'men': return 'men’s team'
    case 'women': return 'women’s team'
    case 'mixed': return 'mixed team'
    case 'boys': return 'boys’ team'
    case 'girls': return 'girls’ team'
    default: return null
  }
}

/** Normalised team key ("men" | "women" | "mixed" | "boys" | "girls") from the enum or the pill label. */
export function teamKey(team: unknown): string | null {
  const t = clean(team).toLowerCase().replace(/[’']s?$/, '').replace(/[’']/g, '')
  return ['men', 'women', 'mixed', 'boys', 'girls'].includes(t) ? t : null
}

/**
 * The club's league for the role's team: Women / Girls → women's league, Men / Boys →
 * men's league. Mixed (or no team) uses a league only when the club has just one.
 * Never borrows the other side's league when the matching one is empty.
 */
export function leagueForTeam(team: unknown, mensLeague: string | null | undefined, womensLeague: string | null | undefined): string | null {
  const men = clean(mensLeague, 120) || null
  const women = clean(womensLeague, 120) || null
  switch (teamKey(team)) {
    case 'women':
    case 'girls':
      return women
    case 'men':
    case 'boys':
      return men
    default:
      if (men && women) return men === women ? men : null
      return men ?? women
  }
}

/** "a midfielder for the men's team" / "an assistant coach". */
export function lookingFor(a: Answers): string {
  const noun = roleNoun(a)
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a'
  const team = teamPhrase(a.team)
  return `${article} ${noun}${team ? ` for the ${team}` : ''}`
}

/** Never ship a bracketed prompt ("[training days]"): drop any sentence that has one. */
export function stripPlaceholders(text: string): string {
  if (!/\[[^\]]*\]/.test(text)) return text
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]
  return sentences.filter((s) => !/\[[^\]]*\]/.test(s)).join('').replace(/\s+/g, ' ').trim()
}

export function facts(a: Answers, clubName: string, league: string | null): string[] {
  const out: string[] = []
  out.push(`Club: ${clubName}${league ? ` (${league})` : ''}`)
  out.push(`Looking for: ${lookingFor(a)}`)
  if (clean(a.title)) out.push(`Role title: ${clean(a.title, 120)}`)
  if (clean(a.level)) out.push(`Level: ${human(clean(a.level))}`)
  const skills = (a.skills ?? []).map((s) => human(clean(s))).filter(Boolean)
  if (skills.length) out.push(`Specialist skills wanted: ${skills.join(', ')}`)
  if (clean(a.start) || clean(a.duration)) out.push(`When: ${[clean(a.start) && `from ${clean(a.start)}`, clean(a.duration)].filter(Boolean).join(', ')}`)
  const place = [clean(a.city), clean(a.country)].filter(Boolean).join(', ')
  if (place) out.push(`Where: ${place}`)
  if (clean(a.pay)) out.push(`Pay: ${a.pay === 'unpaid_development' ? 'unpaid / development' : human(clean(a.pay))}`)
  const pkg = (a.package ?? []).map((s) => human(clean(s))).filter(Boolean)
  if (pkg.length) out.push(`Package: ${pkg.join(', ')}`)
  if (a.euPassport) out.push('EU passport required')
  return out
}

export function template(a: Answers, clubName: string): string {
  const place = clean(a.city) || clean(a.country)
  const lines = [`${clubName} is looking for ${lookingFor(a)}${place ? `, based in ${place}` : ''}.`]
  const when = [clean(a.start) && `from ${clean(a.start)}`, clean(a.duration) && `for ${clean(a.duration).toLowerCase()}`].filter(Boolean).join(' ')
  if (when) lines.push(`The role runs ${when}.`)
  const pkg = (a.package ?? []).map((s) => human(clean(s))).filter(Boolean)
  if (pkg.length) lines.push(`We offer ${pkg.join(', ')}.`)
  lines.push(a.type === 'coach'
    ? 'Tell us about your coaching so far and when you are available.'
    : 'Tell us about your season so far and when you are available.')
  return lines.join(' ')
}

// ============================================================================
// Spanish (Stage 3, 2026-11-16): the club's posting in its interface language
// ============================================================================

/** The "About the role" system prompt (moved from index.ts; English unchanged). */
export const ROLE_DESCRIPTION_SYSTEM = [
  'You write the "About the role" text for a field hockey club posting a role on Hockia.',
  'Write as the club, first person plural ("we"), warm and plain. 3–5 short sentences, under 600 characters.',
  'Use ONLY the facts given. Never invent training days, facilities, salaries, results or promises.',
  'If a detail is missing, leave it out. Never write placeholders, brackets or blanks for the club to fill.',
  'Write the team naturally, e.g. "a midfielder for our men\'s team", never "a Men midfielder".',
  'No emoji, no hashtags, no headings, no bullet points.',
  'Never use em dashes (—) in your answers; use a period, a colon, a comma or parentheses.',
  'Reply with the text only.',
].join('\n')

export function roleDescriptionSystem(lang: MemberLanguage = 'en'): string {
  return withOutputLanguage(ROLE_DESCRIPTION_SYSTEM, lang)
}

const TEAM_ES: Record<string, string> = {
  men: 'el equipo de Caballeros',
  women: 'el equipo de Damas',
  mixed: 'el equipo mixto',
  boys: 'Juveniles caballeros',
  girls: 'Juveniles damas',
}

const PACKAGE_ES: Record<string, string> = {
  housing: 'alojamiento',
  flights: 'pasajes',
  insurance: 'seguro',
  job: 'trabajo',
  car: 'auto',
  visa: 'visa',
  bonuses: 'premios',
  equipment: 'equipamiento',
}

/** "volante para el equipo de Damas" / "entrenador/a asistente". */
export function lookingForEs(a: Answers): string {
  const raw = clean(a.position).toLowerCase()
  const noun = raw
    ? (spanishPositionLabel(raw) ?? human(raw)).toLowerCase()
    : a.type === 'coach' ? 'entrenador/a' : 'jugador/a'
  const key = teamKey(a.team)
  return `${noun}${key ? ` para ${TEAM_ES[key]}` : ''}`
}

/** Spanish duration words for the form's DURATIONS; unknown values as given. */
export function durationEs(value: string): string {
  const v = value.trim()
  const m = /^(\d+) months?$/i.exec(v)
  if (m) return m[1] === '1' ? '1 mes' : `${m[1]} meses`
  if (/^full season$/i.test(v)) return 'toda la temporada'
  if (/^permanent$/i.test(v)) return 'tiempo indefinido'
  return v
}

/** The Spanish template (same facts and shape as template). */
export function templateEs(a: Answers, clubName: string): string {
  const place = clean(a.city) || clean(a.country)
  const lines = [`${clubName} busca ${lookingForEs(a)}${place ? `, con base en ${place}` : ''}.`]
  const start = clean(a.start)
  const duration = clean(a.duration)
  const when = [start && `desde ${start}`, duration && `por ${durationEs(duration)}`].filter(Boolean).join(' ')
  if (when) lines.push(`La oportunidad es ${when}.`)
  const pkg = (a.package ?? []).map((s) => clean(s)).filter(Boolean).map((s) => PACKAGE_ES[s.toLowerCase()] ?? human(s))
  if (pkg.length) lines.push(`Ofrecemos ${pkg.join(', ')}.`)
  lines.push(a.type === 'coach'
    ? 'Nos interesa conocer tu experiencia como entrenador/a y tu disponibilidad.'
    : 'Nos interesa conocer tu temporada hasta ahora y tu disponibilidad.')
  return lines.join(' ')
}

/** template in the club's language. */
export function templateFor(a: Answers, clubName: string, lang: MemberLanguage = 'en'): string {
  return lang === 'es' ? templateEs(a, clubName) : template(a, clubName)
}
