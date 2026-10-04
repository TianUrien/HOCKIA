import type { FitState } from '@/lib/clubRecruiting'
import { toEvidence, type SuggestionEvidence, type SuggestionRoleContext } from '@/lib/suggestionReasons'

/**
 * D5 · Hockia suggests (Figma "New-Hockia" D5.1 398:83, D5.2 398:291) — copy
 * and the client shape of get_role_suggestions (migration 20261004100000,
 * the server owns every rule: suggestible = open to play AND 18+, fenced,
 * top 5 recomputed nightly and on role change). Club-side only: players never
 * see a suggestion, a rank or a fit.
 */

export const SUGGESTS_TITLE = 'Hockia suggests'
export const SUGGESTS_FOOTNOTE = 'Only players who are open to play and over 18. Players never see where they rank.'
export const SUGGESTS_EMPTY = 'No players fit this role yet — Hockia checks again tonight.'
export const SUGGESTS_COMPOSER_PLACEHOLDER = 'Ask Hockia: EU passport, start in January…'
export const SUGGESTS_LOAD_ERROR = 'Couldn’t load suggestions. Pull to try again.'
export const REFINE_TITLE = 'Hockia AI'
export const REFINE_BACK = 'Suggested'
export const REFINE_COMPOSER_PLACEHOLDER = 'Ask about players for this role'
export const REFINE_NO_MATCH = 'None of the suggestions match that on their profiles.'

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five']

/** "For Midfielder. Five players who fit and haven't applied, ranked by fit, then by what they've shown." */
export function suggestsIntro(roleTitle: string | null | undefined, count: number): string {
  const n = Math.max(0, Math.min(5, Math.floor(count)))
  const who = n === 1 ? 'One player who fits and hasn’t applied' : `${COUNT_WORDS[n]} players who fit and haven’t applied`
  const lead = roleTitle?.trim() ? `For ${roleTitle.trim()}. ` : ''
  return n === 0 ? `${lead}Players who fit and haven’t applied, ranked by fit, then by what they’ve shown.` : `${lead}${who}, ranked by fit, then by what they’ve shown.`
}

/** Entry row on the club's role: "Hockia suggests · 5 players" / "None yet" (no count when 0). */
export function suggestsEntryDetail(count: number | null | undefined): string | null {
  if (count === null || count === undefined) return null
  if (count <= 0) return 'None yet'
  return `${count} player${count === 1 ? '' : 's'}`
}

/** D5.2 caption under the matches. */
export function refineCaption(pool: number): string {
  const n = Math.max(0, Math.floor(pool))
  return `From Hockia’s ${n} suggestion${n === 1 ? '' : 's'} for this role · only facts from their profiles`
}

export interface RoleSuggestion {
  rank: number
  player_id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  position: string | null
  secondary_position: string | null
  nationality_country_id: number | null
  nationality2_country_id: number | null
  fit_state: FitState
  evidence: SuggestionEvidence
}

export interface RoleSuggestionsPayload {
  role: SuggestionRoleContext & { id: string; title: string; status: string; opportunity_type: string | null }
  computed_at: string | null
  suggestions: RoleSuggestion[]
}

const asNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const asStr = (v: unknown) => (typeof v === 'string' ? v : null)

/** Parse the RPC jsonb defensively; NULL (not the publisher) → null. At most 5 rows. */
export function parseRoleSuggestions(raw: unknown): RoleSuggestionsPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const role = (r.role && typeof r.role === 'object' ? r.role : null) as Record<string, unknown> | null
  if (!role || typeof role.id !== 'string') return null
  const list = Array.isArray(r.suggestions) ? r.suggestions : []
  const suggestions: RoleSuggestion[] = list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).player_id === 'string')
    .map((s, i): RoleSuggestion => {
      const fit = s.fit_state
      return {
        rank: asNum(s.rank) ?? i + 1,
        player_id: s.player_id as string,
        full_name: asStr(s.full_name),
        avatar_url: asStr(s.avatar_url),
        role: asStr(s.role),
        position: asStr(s.position),
        secondary_position: asStr(s.secondary_position),
        nationality_country_id: asNum(s.nationality_country_id),
        nationality2_country_id: asNum(s.nationality2_country_id),
        fit_state: fit === 'green' || fit === 'yellow' ? fit : 'grey',
        evidence: toEvidence(s.evidence),
      }
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
  return {
    role: {
      id: role.id as string,
      title: asStr(role.title) ?? '',
      status: asStr(role.status) ?? '',
      opportunity_type: asStr(role.opportunity_type),
      position: asStr(role.position),
      gender: asStr(role.gender),
      eu_passport_required: role.eu_passport_required === true,
      start_date: asStr(role.start_date),
    },
    computed_at: asStr(r.computed_at),
    suggestions,
  }
}

/** Flag emojis for a card's subtitle ("Player · Midfielder · Defender · 🇦🇷 🇮🇹"). */
export function flagsFor(ids: (number | null)[], countries: { id: number; flag_emoji?: string | null }[]): string | null {
  const flags = ids
    .filter((id, i, all): id is number => typeof id === 'number' && all.indexOf(id) === i)
    .map((id) => countries.find((c) => c.id === id)?.flag_emoji)
    .filter((f): f is string => !!f)
  return flags.length ? flags.join(' ') : null
}

// ── D5.2 refine (nl-search mode role_suggestions_refine) ─────────────────

export type RefineKind = 'answer' | 'cap_reached' | 'error'

export interface RefineAnswer {
  kind: RefineKind
  message: string
  /** Player ids from the stored 5, in the order the answer ranks them. */
  matchIds: string[]
  chips: string[]
}

/**
 * Read the edge function's answer. Only ids that are among the stored
 * suggestions survive (the server already enforces it; this is the belt).
 */
export function parseRefineResponse(raw: unknown, poolIds: string[]): RefineAnswer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.kind === 'cap_reached') return { kind: 'cap_reached', message: asStr(r.ai_message) ?? '', matchIds: [], chips: [] }
  if (r.success !== true || r.kind !== 'role_suggestions_refine') return { kind: 'error', message: '', matchIds: [], chips: [] }
  const pool = new Set(poolIds)
  const ids = (Array.isArray(r.match_ids) ? r.match_ids : [])
    .filter((id): id is string => typeof id === 'string' && pool.has(id))
    .filter((id, i, all) => all.indexOf(id) === i)
  const chips = (Array.isArray(r.chips) ? r.chips : [])
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0 && c.length <= 40)
    .slice(0, 3)
  return { kind: 'answer', message: asStr(r.ai_message)?.trim() ?? '', matchIds: ids, chips }
}
