/**
 * D5.2 · Hockia AI refine over a role's suggestions (nl-search mode
 * `role_suggestions_refine`; founder ruling 2026-10-04).
 *
 * The club asks a question about the role's stored top 5 (role_suggestions,
 * migration 20261004100000). The LLM may only FILTER and RE-ORDER those
 * players, using their public profile facts, and must say what the profiles
 * can't confirm. It never sees private data: the candidate facts below are
 * built from get_role_suggestions (which is fenced and returns no date of
 * birth, email or phone) plus public country names, and players are named to
 * the model by short refs (P1..P5), never by id.
 *
 * Everything here is pure and unit-tested (role-suggestions-refine.test.ts);
 * the provider calls live in llm-client.ts (refineRoleSuggestions).
 */

export const REFINE_MODE = 'role_suggestions_refine'
export const REFINE_MAX_CANDIDATES = 5
export const REFINE_ANSWER_MAX = 600
export const REFINE_CHIP_MAX = 40

export interface RefineRole {
  title: string
  position: string | null
  gender: string | null
  eu_passport_required: boolean
  start_date: string | null
}

/** Public facts for one candidate, as the model sees them. */
export interface RefineCandidate {
  ref: string
  player_id: string
  name: string
  positions: string[]
  category: string | null
  nationalities: string[]
  eu_passport: boolean
  available_from: string | null
  full_matches: number
  highlights: number
  league: string | null
  league_self_reported: boolean
  active_this_month: boolean
  career_entries: number
  references: number
  fit: 'Strong fit' | 'Possible fit' | null
}

export interface CountryName { id: number; name: string; common_name?: string | null }

const CATEGORY: Record<string, string> = {
  adult_women: "Women's",
  adult_men: "Men's",
  girls: 'Girls',
  boys: 'Boys',
  mixed: 'Mixed',
}

/** Keys that must never reach the model, whatever the RPC returns. */
export const PRIVATE_KEYS = ['date_of_birth', 'dob', 'age', 'email', 'phone', 'contact_email', 'contact_phone', 'address'] as const

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const label = (v: string | null) => (v ? v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null)

/**
 * Turn get_role_suggestions' jsonb into the model's candidate list. Only the
 * whitelisted public fields are copied, so an unexpected private key in the
 * payload can't leak.
 */
export function buildRefineCandidates(payload: unknown, countries: CountryName[]): { role: RefineRole; candidates: RefineCandidate[] } | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const r = (p.role && typeof p.role === 'object' ? p.role : null) as Record<string, unknown> | null
  if (!r) return null
  const role: RefineRole = {
    title: str(r.title) ?? 'this role',
    position: str(r.position),
    gender: str(r.gender),
    eu_passport_required: r.eu_passport_required === true,
    start_date: str(r.start_date),
  }
  const byId = new Map(countries.map((c) => [c.id, c.common_name || c.name]))
  const list = Array.isArray(p.suggestions) ? p.suggestions : []
  const candidates = list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).player_id === 'string')
    .slice(0, REFINE_MAX_CANDIDATES)
    .map((s, i): RefineCandidate => {
      const ev = (s.evidence && typeof s.evidence === 'object' ? s.evidence : {}) as Record<string, unknown>
      const nat = [s.nationality_country_id, s.nationality2_country_id]
        .filter((id, j, all): id is number => typeof id === 'number' && all.indexOf(id) === j)
        .map((id) => byId.get(id))
        .filter((n): n is string => !!n)
      const positions = [str(s.position), str(s.secondary_position)]
        .filter((v, j, all): v is string => !!v && all.indexOf(v) === j)
        .map((v) => label(v) as string)
      return {
        ref: `P${i + 1}`,
        player_id: s.player_id as string,
        name: str(s.full_name) ?? `Player ${i + 1}`,
        positions,
        category: CATEGORY[str(ev.playing_category) ?? ''] ?? null,
        nationalities: nat,
        eu_passport: ev.eu_passport === true,
        available_from: str(ev.available_from),
        full_matches: num(ev.full_matches),
        highlights: num(ev.highlights),
        league: str(ev.league_name),
        league_self_reported: ev.league_self_reported === true,
        active_this_month: ev.active_30d === true,
        career_entries: num(ev.career_entries),
        references: num(ev.references),
        fit: s.fit_state === 'green' ? 'Strong fit' : s.fit_state === 'yellow' ? 'Possible fit' : null,
      }
    })
  return { role, candidates }
}

export const REFINE_SYSTEM_PROMPT = `You are Hockia AI helping a field-hockey club look at the players Hockia suggested for ONE of its open roles.

You get the role and up to five suggested players, each with a short ref (P1..P5) and ONLY the facts from their public Hockia profile. The club asks a question (for example "EU passport, start in January").

Your job:
1. Decide which of the listed players match the question, using ONLY the listed facts. Return their refs in "matches", best first. You may re-order them. Never add anyone who is not listed. If nobody matches, return an empty list.
2. Write "answer": 1 to 3 short sentences in plain text. Name the players who match and the fact that makes them match. Then say plainly what the profiles CAN'T confirm (a missing fact is unknown, not a no). Suggest asking the player when something can't be confirmed.
3. Return up to 3 short follow-up questions in "chips" (each under 40 characters), phrased as the club would ask them.

Rules:
- Facts only. Never guess age, height, salary, character, injuries or anything not in the list. Never invent a league, club, passport or date.
- Never mention refs (P1), ids, scores, numbers of a ranking or the word "rank". Use names.
- Gender-neutral language: use the player's name or "they", never he/she/his/her.
- No markdown, no bullet points, no emojis.
- Players never see this conversation; still, be respectful and factual.`

export const REFINE_TOOL = {
  name: 'refine_role_suggestions',
  description: 'Filter and re-order the suggested players for the club question, using only their listed profile facts.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: '1-3 short plain-text sentences: who matches and why, then what the profiles cannot confirm.' },
      matches: { type: 'array', items: { type: 'string' }, description: 'Refs (P1..P5) of the matching players, best first. Empty if none.' },
      chips: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short follow-up questions (under 40 characters).' },
    },
    required: ['answer', 'matches'],
  },
}

function factLine(c: RefineCandidate): string {
  const facts: string[] = []
  facts.push(c.positions.length ? `positions: ${c.positions.join(', ')}` : 'positions: not on the profile')
  if (c.category) facts.push(`plays: ${c.category}`)
  facts.push(c.nationalities.length ? `nationality: ${c.nationalities.join(' and ')}` : 'nationality: not on the profile')
  facts.push(c.eu_passport ? 'EU passport: yes' : 'EU passport: not on the profile')
  facts.push(c.available_from ? `available from: ${c.available_from}` : 'start date: not on the profile')
  facts.push(c.league ? `league: ${c.league}${c.league_self_reported ? ' (self-reported)' : ''}` : 'league: not on the profile')
  facts.push(`full matches on the profile: ${c.full_matches}`)
  facts.push(`highlight videos: ${c.highlights}`)
  facts.push(`career entries: ${c.career_entries}`)
  facts.push(`references: ${c.references}`)
  if (c.active_this_month) facts.push('active on Hockia this month')
  if (c.fit) facts.push(`Hockia fit: ${c.fit}`)
  return `${c.ref} · ${c.name} · ${facts.join(' · ')}`
}

export function buildRefineUserMessage(question: string, role: RefineRole, candidates: RefineCandidate[]): string {
  const roleFacts = [
    `title: ${role.title}`,
    role.position ? `position: ${label(role.position)}` : null,
    role.gender ? `team: ${role.gender}` : null,
    `EU passport required: ${role.eu_passport_required ? 'yes' : 'no'}`,
    role.start_date ? `start date: ${role.start_date}` : null,
  ].filter(Boolean).join(' · ')
  return `ROLE: ${roleFacts}

SUGGESTED PLAYERS (facts from their public profiles only):
${candidates.map(factLine).join('\n')}

CLUB QUESTION: "${question.replace(/"/g, "'").slice(0, 500)}"

Answer per the system prompt.`
}

export interface RefineResult {
  answer: string
  match_ids: string[]
  chips: string[]
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const REF_RE = /\bP[1-9]\b/g
const RANK_RE = /\b(rank(?:ed|ing|s)?|fit score|match score)\b/i

/** Gendered pronouns the copy rule forbids (the prompt asks; this checks). */
const PRONOUN_RE = /\b(he|she|him|his|her|hers|himself|herself)\b/i

/**
 * Validate the model's tool output: refs → ids among the candidates only (in
 * the model's order, deduplicated), no ids / refs / ranking words in the
 * text, length caps. `fallback` is used when the answer is empty or unusable.
 */
export function normalizeRefineResult(raw: unknown, candidates: RefineCandidate[], fallback: string): RefineResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const byRef = new Map(candidates.map((c) => [c.ref.toUpperCase(), c.player_id]))
  const ids = (Array.isArray(r.matches) ? r.matches : [])
    .map((m) => (typeof m === 'string' ? byRef.get(m.trim().toUpperCase()) : undefined))
    .filter((id): id is string => !!id)
    .filter((id, i, all) => all.indexOf(id) === i)

  let answer = typeof r.answer === 'string' ? r.answer : ''
  // Replace any ref with the player's name, drop ids, strip markdown symbols.
  const nameByRef = new Map(candidates.map((c) => [c.ref.toUpperCase(), c.name]))
  answer = answer
    .replace(REF_RE, (m) => nameByRef.get(m.toUpperCase()) ?? '')
    .replace(UUID_RE, '')
    .replace(/[*#`_]+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  // A sentence that ranks people or uses a gendered pronoun is dropped.
  answer = answer
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !RANK_RE.test(s) && !PRONOUN_RE.test(s))
    .join(' ')
    .trim()
  if (answer.length > REFINE_ANSWER_MAX) answer = `${answer.slice(0, REFINE_ANSWER_MAX - 1).trimEnd()}…`
  if (!answer) answer = fallback

  const chips = (Array.isArray(r.chips) ? r.chips : [])
    .filter((c): c is string => typeof c === 'string' && !/\bP[1-9]\b/.test(c) && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(c))
    .map((c) => c.replace(/[*#`_]+/g, '').trim())
    .filter((c) => c.length > 0 && c.length <= REFINE_CHIP_MAX && !PRONOUN_RE.test(c))
    .filter((c, i, all) => all.indexOf(c) === i)
    .slice(0, 3)

  return { answer, match_ids: ids, chips }
}

/** Fallback copy when there's nothing to refine, or the model returned nothing usable. */
export const REFINE_EMPTY_POOL = 'There are no suggestions for this role yet — Hockia checks again tonight.'
export const REFINE_FALLBACK = 'I couldn’t match that against the suggested players’ profiles. Try asking about one fact, like a passport or a start date.'

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_ONLY.test(v)
}
