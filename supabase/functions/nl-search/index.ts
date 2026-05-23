// deno-lint-ignore-file no-explicit-any
/**
 * Natural Language Search edge function.
 *
 * Accepts a natural language query, parses it into structured filters via an
 * LLM (Gemini by default, swappable via LLM_PROVIDER env var), resolves text
 * values to database IDs, and calls the discover_profiles RPC.
 *
 * POST /functions/v1/nl-search
 * Body: { query: string, history?: { role: 'user'|'assistant', content: string }[] }
 * Auth: Bearer token (authenticated users only)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
import { parseSearchQuery, synthesizeQualitativeInsights, composeNoResults, answerPlatformHelp, PROMPT_VERSION, type LLMCallMeta, type ParsedFilters, type HistoryTurn, type ProfileQualitativeData, type UserContext } from '../_shared/llm-client.ts'
import { classifyEntityType, entityTypeToRole, type RoutedIntent } from '../_shared/intent-router.ts'
import { resolveFeatureCta } from '../_shared/hockia-features.ts'
import {
  type AppliedSearch,
  buildRoleSummary,
  type ClarifyingOption,
  getGreetingActions,
  getNoResultsActions,
  getRecoveryActions,
  getRepeatedSoftErrorActions,
  getSelfAdviceActions,
  getSoftErrorActions,
  type ResponseKind,
  type SuggestedAction,
} from '../_shared/suggested-actions.ts'
import { detectRecoveryQuery } from '../_shared/recovery.ts'
import { detectClarifyingNeed } from '../_shared/clarifying.ts'

// EU passport country code list — single source of truth for eu_passport
// derivation. discover_profiles uses the same set internally to filter, but
// it does NOT project an eu_passport column, so we mirror the derivation
// here for both UserContext (caller's own EU status) and the Phase 4 MVP-A
// shortlist builder (per-row EU status).
const EU_PASSPORT_CODES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
])

// Map raw coach_specialization enum values to human-readable labels for the
// shortlist prompt. Mirrors the client-side label map in
// client/src/lib/coachSpecializations.ts so the LLM sees natural prose
// regardless of provider — defends against future model swaps that might
// echo enum strings back to users.
const COACH_SPECIALIZATION_LABEL: Record<string, string> = {
  head_coach: 'head coach',
  assistant_coach: 'assistant coach',
  goalkeeper_coach: 'goalkeeper coach',
  youth_coach: 'youth coach',
  strength_conditioning: 'strength & conditioning coach',
  performance_analyst: 'performance analyst',
  sports_scientist: 'sports scientist',
  other: 'other',
}

interface DiscoveryEventParams {
  user_id: string
  role: string | null
  query_text: string
  intent: string
  parsed_filters: ParsedFilters | null
  result_count: number
  has_qualitative: boolean
  llm_provider: string
  response_time_ms: number
  error_message: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  cached_tokens: number | null
  prompt_version: string
  fallback_used: boolean
  retry_count: number
}

/** Insert a discovery event row. Called via fireAndForget so it never blocks
 *  the response; swallows any insert error to stay analytics-only. */
async function logDiscoveryEvent(
  // deno-lint-ignore no-explicit-any
  client: any,
  params: DiscoveryEventParams
): Promise<void> {
  try {
    await client.from('discovery_events').insert({
      user_id: params.user_id,
      role: params.role,
      query_text: params.query_text,
      intent: params.intent,
      parsed_filters: params.parsed_filters,
      result_count: params.result_count,
      has_qualitative: params.has_qualitative,
      llm_provider: params.llm_provider,
      response_time_ms: params.response_time_ms,
      error_message: params.error_message,
      prompt_tokens: params.prompt_tokens,
      completion_tokens: params.completion_tokens,
      cached_tokens: params.cached_tokens,
      prompt_version: params.prompt_version,
      fallback_used: params.fallback_used,
      retry_count: params.retry_count,
    })
  } catch {
    // Never fail the response over analytics logging
  }
}

/** Run a promise detached from the response lifecycle. Uses EdgeRuntime.waitUntil
 *  when available (keeps the runtime alive until the promise settles) and falls
 *  back to a plain catch in local dev. */
function fireAndForget(promise: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const edgeRuntime = (globalThis as any).EdgeRuntime
  const tracked = promise.catch(() => null)
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(tracked)
  }
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

/** Result-count limits for Hockia AI search (Phase 1a). */
const DEFAULT_RESULT_LIMIT = 5
const MAX_RESULT_LIMIT = 25

/** English number words Hockia AI understands as result counts. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
}
const NUMBER_WORD_KEYS = Object.keys(NUMBER_WORDS).join('|')
// A count token is a 1–3 digit number OR an English number word.
const NUMBER_TOKEN = `\\d{1,3}|${NUMBER_WORD_KEYS}`
// Up to 3 filler words may sit between the count and the result noun
// ("2 [great young] players") — but never a number word or "and", which
// mark the *next* count in a compound query and must not be swallowed.
const COUNT_FILLER = `(?:(?!(?:${NUMBER_WORD_KEYS}|and)\\b)[a-z'’-]+\\s+){0,3}`

/**
 * Normalise colloquial English count phrases ("a couple of players",
 * "a few clubs") into digit form so tryExtractCount / extractRoleCounts
 * see them as ordinary counts. Production audit B10: "a couple of"
 * silently became the default 5 instead of 2.
 */
function normalizeColloquialCounts(q: string): string {
  return q
    .replace(/\ba couple of\b/gi, '2 ')
    .replace(/\ba couple\b/gi, '2 ')
    .replace(/\ba pair of\b/gi, '2 ')
    .replace(/\ba few\b/gi, '3 ')
    .replace(/\ba handful of\b/gi, '5 ')
}

/** Parse a count token (digits or a number word) → positive integer | null. */
function parseCountToken(token: string): number | null {
  const t = token.toLowerCase()
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return NUMBER_WORDS[t] ?? null
}

/** Hockey position nouns Hockia AI counts by ("10 defenders") — a
 *  defender is a player, but the user names them by position. Singular
 *  and plural both accepted. */
const POSITION_NOUNS = 'goalkeepers?|defenders?|midfielders?|forwards?|strikers?|attackers?'

/**
 * Try to extract an explicit result count from the raw query.
 *
 * Returns the parsed number (clamped to MAX_RESULT_LIMIT) when the user
 * named one — digits or number words, sitting next to a recognised role
 * *or* position noun ("show me 10 defenders", "find five clubs", "top 3
 * coaches"). Returns null when no count was given so the caller can apply
 * its own default (general searches default to 5; the world-club path
 * keeps a larger directory window).
 *
 * A number immediately followed by an age word is ignored — so "25 year
 * old players", "U25 defenders" and "2+ references" never read as a count.
 */
function tryExtractCount(rawQuery: string): number | null {
  const q = normalizeColloquialCounts(rawQuery)
  const noun = `players?|coaches?|clubs?|brands?|umpires?|profiles?|results?|people|users?|options?|matches|${POSITION_NOUNS}`
  const m =
    q.match(
      new RegExp(`\\b(${NUMBER_TOKEN})\\s+(?!years?\\b|yo\\b|yr\\b)${COUNT_FILLER}(?:${noun})\\b`, 'i'),
    ) ||
    q.match(new RegExp(`\\b(?:top|best|first)\\s+(${NUMBER_TOKEN})\\b`, 'i'))
  if (m) {
    const n = parseCountToken(m[1])
    if (n != null && n > 0) return Math.min(n, MAX_RESULT_LIMIT)
  }
  return null
}

/** Resolve how many results a search should return — explicit count when
 *  named, otherwise DEFAULT_RESULT_LIMIT ("the best 5 first"). The world-
 *  club path uses tryExtractCount directly with its own default. */
function resolveResultLimit(rawQuery: string): number {
  return tryExtractCount(rawQuery) ?? DEFAULT_RESULT_LIMIT
}

/** Result-noun → canonical role. Drives compound multi-role detection. */
const ROLE_NOUNS: Record<string, string> = {
  player: 'player', players: 'player',
  coach: 'coach', coaches: 'coach',
  club: 'club', clubs: 'club',
  brand: 'brand', brands: 'brand',
  umpire: 'umpire', umpires: 'umpire',
}

/** Position noun → canonical lowercase position (matches the values
 *  stored in profiles.position / secondary_position). Positions always
 *  belong to the 'player' role, so a compound entry with a position
 *  becomes role='player' + a position filter on that sub-search. */
const POSITION_TO_ROLE: Record<string, string> = {
  goalkeeper: 'goalkeeper', goalkeepers: 'goalkeeper',
  defender: 'defender', defenders: 'defender',
  midfielder: 'midfielder', midfielders: 'midfielder',
  forward: 'forward', forwards: 'forward',
  striker: 'striker', strikers: 'striker',
  attacker: 'attacker', attackers: 'attacker',
}

/** Canonical role → [singular, plural] label. */
const ROLE_LABELS: Record<string, [string, string]> = {
  player: ['player', 'players'],
  coach: ['coach', 'coaches'],
  club: ['club', 'clubs'],
  brand: ['brand', 'brands'],
  umpire: ['umpire', 'umpires'],
}

function roleLabel(role: string, n: number): string {
  const pair = ROLE_LABELS[role]
  return pair ? pair[n === 1 ? 0 : 1] : role
}

/** Join ["2 players","1 coach"] → "2 players and 1 coach". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Phase 1c (+ audit round 3) — extract every explicit "<count> <noun>" pair
 * from a query, in order, de-duped by (role, position):
 *   "Find me 2 players and 1 coach"
 *     → [{role:'player',count:2},{role:'coach',count:1}]
 *   "Find me 1 goalkeeper and 1 midfielder"
 *     → [{role:'player',position:'goalkeeper',count:1},
 *        {role:'player',position:'midfielder',count:1}]
 * Two or more pairs makes it a compound multi-role/position search. Age
 * phrases ("25 year old players") are excluded the same way
 * resolveResultLimit does.
 */
function extractRoleCounts(rawQuery: string): { role: string; position?: string; count: number }[] {
  const q = normalizeColloquialCounts(rawQuery)
  const nouns = [...Object.keys(ROLE_NOUNS), ...Object.keys(POSITION_TO_ROLE)].join('|')
  const re = new RegExp(
    `\\b(${NUMBER_TOKEN})\\s+(?!years?\\b|yo\\b|yr\\b)${COUNT_FILLER}(${nouns})\\b`,
    'gi',
  )
  const out: { role: string; position?: string; count: number }[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(q)) !== null) {
    const count = parseCountToken(m[1])
    const noun = m[2].toLowerCase()
    const position = POSITION_TO_ROLE[noun]
    const role = position ? 'player' : ROLE_NOUNS[noun]
    if (!role || count == null || count <= 0) continue
    const key = position ? `${role}:${position}` : role
    if (seen.has(key)) continue
    seen.add(key)
    const entry: { role: string; position?: string; count: number } = {
      role,
      count: Math.min(count, MAX_RESULT_LIMIT),
    }
    if (position) entry.position = position
    out.push(entry)
  }
  return out
}

/**
 * Compose the response message for a compound multi-role search from the
 * rows actually returned — "Here are 2 players and 1 coach." A requested
 * role that yielded nothing is called out honestly rather than silently
 * dropped.
 */
function buildCompoundMessage(
  roleCounts: { role: string; position?: string; count: number }[],
  rows: { role?: string; position?: string; secondary_position?: string }[],
): string {
  // Position-aware label: a position entry counts in its own units
  // ("1 goalkeeper and 1 midfielder"), not just by role ("2 players").
  const entryLabel = (rc: { role: string; position?: string }, n: number) =>
    rc.position ? (n === 1 ? rc.position : `${rc.position}s`) : roleLabel(rc.role, n)
  const present: string[] = []
  const absent: string[] = []
  for (const rc of roleCounts) {
    const matches = rc.position
      ? rows.filter(r =>
          r.role === rc.role &&
          (r.position?.toLowerCase() === rc.position ||
            r.secondary_position?.toLowerCase() === rc.position))
      : rows.filter(r => r.role === rc.role)
    const got = matches.length
    if (got > 0) present.push(`${got} ${entryLabel(rc, got)}`)
    else absent.push(entryLabel(rc, 2))
  }
  let msg = ''
  if (present.length > 0) {
    const verb = present.length === 1 && present[0].startsWith('1 ') ? 'is' : 'are'
    msg = `Here ${verb} ${joinList(present)}, ranked by profile completeness.`
  }
  if (absent.length > 0) {
    msg += `${msg ? ' ' : ''}I couldn't find any ${joinList(absent)} matching that.`
  }
  return msg || 'No matching profiles found.'
}

// ─────────────────────────────────────────────────────────────────────────
// Bio credentials — keyword scan of about-me prose (Phase 6, B14)
// ─────────────────────────────────────────────────────────────────────────
//
// The ranker historically only read structured fields (Journey, references,
// current_club, media) — so a Marcia LaPlante with World Cup / Pan Am /
// NCAA credentials in her bio prose ranked as "Good match" with thin
// bullets while less-decorated profiles outscored her. Scan the bio for
// high-signal terms and treat each hit as a strength signal AND a card
// bullet. Cheap (regex) and zero LLM cost.

const BIO_CREDENTIAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bworld cup\b/i, label: 'World Cup experience' },
  { pattern: /\bolympic[s]?\b/i, label: 'Olympic experience' },
  { pattern: /\bcommonwealth games?\b/i, label: 'Commonwealth Games' },
  { pattern: /\bpan ?am(?:erican)?(?:\s+games?)?\b/i, label: 'Pan American competition' },
  { pattern: /\bchampions trophy\b/i, label: 'Champions Trophy' },
  { pattern: /\bfih (?:level|world|pro|champion|hockey)/i, label: 'FIH credential' },
  { pattern: /\bnational team\b/i, label: 'National team' },
  { pattern: /\bncaa( division)?\b/i, label: 'NCAA experience' },
  { pattern: /\bpremier(?:ship| league)\b/i, label: 'Premier League / Premiership' },
  { pattern: /\beuro(?:pean| ?hockey) (?:league|cup)\b/i, label: 'European hockey competition' },
  { pattern: /\beuro hockey league\b/i, label: 'Euro Hockey League' },
  { pattern: /\bcaptain(?:ed)?\b/i, label: 'Captain' },
  { pattern: /\bgold medal\b/i, label: 'Gold medal' },
  { pattern: /\bsilver medal\b/i, label: 'Silver medal' },
  { pattern: /\bbronze medal\b/i, label: 'Bronze medal' },
]

/** Returns the de-duped credential labels found in the bio. Order matches
 *  the BIO_CREDENTIAL_PATTERNS list (so World Cup beats Pan Am beats NCAA). */
function detectBioCredentials(bio: string | null | undefined): string[] {
  if (!bio) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const { pattern, label } of BIO_CREDENTIAL_PATTERNS) {
    if (pattern.test(bio) && !seen.has(label)) {
      out.push(label)
      seen.add(label)
    }
  }
  return out
}

/** Free-text Journey-entry highlights ("Top Scorer 2025 top max high") are
 *  user-entered and can be noisy — filter the obvious junk before promoting
 *  to a recruiter-facing bullet (Phase 6, B19). */
function isCleanHighlightText(s: string): boolean {
  const t = s.trim()
  if (t.length < 4 || t.length > 70) return false
  const words = t.split(/\s+/)
  // Any single word > 18 chars likely a typo or run-on string.
  if (words.some(w => w.length > 18)) return false
  // Three consecutive identical words = repetition glitch ("top top top").
  for (let i = 0; i < words.length - 2; i++) {
    const w = words[i].toLowerCase()
    if (w === words[i + 1].toLowerCase() && w === words[i + 2].toLowerCase()) return false
  }
  return true
}

/** Rule-based fit_level for a discover result. All returned rows already
 *  match the search criteria (hard filters in discover_profiles), so this
 *  reflects PROFILE STRENGTH — the deterministic replacement for the LLM
 *  composeShortlist pass that used to produce non-deterministic tiers. */
function fitLevelForDiscoverResult(
  r: { accepted_reference_count?: number; current_club?: string | null; career_entry_count?: number; highlight_video_url?: string | null; profile_completeness_pct?: number | null },
  career: { entry_type?: string | null }[],
  bioCredCount: number,
): 'strong_match' | 'possible_match' | 'needs_more_info' {
  let strength = 0
  strength += Math.min((r.accepted_reference_count ?? 0) * 2, 6)
  if (career.some(c => c.entry_type === 'national_team')) strength += 3
  if (r.current_club) strength += 1
  if ((r.career_entry_count ?? 0) >= 3) strength += 1
  if (r.highlight_video_url) strength += 1
  strength += Math.min(bioCredCount * 2, 4)
  const completeness = r.profile_completeness_pct ?? 0
  if (strength >= 5 && completeness >= 60) return 'strong_match'
  if (strength >= 2 || completeness >= 40) return 'possible_match'
  return 'needs_more_info'
}

/** A Journey (career_history) row, narrowed to the fields highlights need. */
interface CareerRow {
  entry_type?: string | null
  club_name?: string | null
  location_country?: string | null
  highlights?: string[] | null
  start_date?: string | null
  end_date?: string | null
}

/**
 * Phase 3 — derive up to 4 concrete, recruiter-facing "Profile highlights"
 * for one profile, purely rule-based (no LLM). Drawn from the player's
 * Journey entries plus a couple of profile signals, in priority order:
 *
 *   1. national-team selection   — the strongest pedigree signal
 *   2. club experience           — the two most-recent clubs
 *   3. verified references       — accepted_reference_count
 *   4. stated achievements       — the per-entry `highlights` the user wrote
 *   5. Journey depth             — entry count, when substantial
 *   6. open to new opportunities — soft availability signal
 *
 * Never emits debug-style reasons ("name matches query") — only concrete
 * facts a recruiter can act on.
 */
function buildProfileHighlights(
  career: CareerRow[],
  result: { accepted_reference_count?: number; open_to_opportunities?: boolean; bio?: string | null },
): string[] {
  // Most-recent first: current roles (no end_date) lead, then by start_date.
  const sorted = [...career].sort((a, b) => {
    const aCurrent = !a.end_date
    const bCurrent = !b.end_date
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    return (b.start_date ?? '').localeCompare(a.start_date ?? '')
  })

  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string | null | undefined) => {
    const t = (raw ?? '').trim()
    if (!t || out.length >= 4) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t.length > 70 ? `${t.slice(0, 67).trimEnd()}…` : t)
  }

  // 1. National-team selection.
  const natTeam = sorted.find(e => e.entry_type === 'national_team' && e.club_name)
  if (natTeam) add(`Selected for ${natTeam.club_name}`)

  // 2. Bio credentials (Phase 6, B14). Surfaces the World Cup / Olympic /
  //    NCAA / Premier League mentions buried in profile bio prose so the
  //    recruiter sees them in the bullets — not just in the score.
  for (const cred of detectBioCredentials(result.bio)) add(cred)

  // 3. Club experience — up to two most-recent clubs.
  let clubs = 0
  for (const e of sorted) {
    if (clubs >= 2) break
    if (e.entry_type === 'club' && e.club_name) {
      add(e.location_country
        ? `Played for ${e.club_name} in ${e.location_country}`
        : `Played for ${e.club_name}`)
      clubs++
    }
  }

  // 4. Verified references.
  const refs = result.accepted_reference_count ?? 0
  if (refs > 0) add(`${refs} accepted reference${refs === 1 ? '' : 's'}`)

  // 5. Stated achievements from Journey entries — free-text, so gate on
  //    isCleanHighlightText to skip typo / repetition glitches (B19).
  for (const e of sorted) {
    for (const h of (e.highlights ?? [])) {
      if (isCleanHighlightText(h)) add(h)
    }
  }

  // 6. Journey depth.
  if (career.length >= 3) add(`${career.length} Journey entries`)

  // 7. Open to new opportunities.
  if (result.open_to_opportunities) add('Open to new opportunities')

  return out.slice(0, 4)
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 — Opportunity-owner recruitment recommendations
// ─────────────────────────────────────────────────────────────────────────
//
// When a club or coach asks Hockia AI "who is my strongest match", "best
// applicants for my opportunity", "who should I review first" — this
// handler answers from their own applicant pipeline. Fit first, profile
// strength second, completeness only as a tiebreaker. Respects the
// owner's triage labels (rejected is never recommended). Bullets are
// rule-based — every claim is traceable to data on the applicant's
// profile, never invented.

const EU_PASSPORT_CODES_OWN = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR',
  'DE','GR','HU','IE','IT','LV','LT','LU','MT','NL',
  'PL','PT','RO','SK','SI','ES','SE',
] as const

// DB enum → user-facing label shown on the Applicants screen.
//
// IMPORTANT: `shortlisted` here means "the owner clicked Good fit" on the
// Applicants screen — it is NOT the ATS-conventional "moved to next round"
// semantic. Future engineers reading the enum: treat shortlisted = Good
// fit owner-action throughout this feature. Owners must never see the
// raw enum string anywhere in the UI.
const TRIAGE_LABEL: Record<string, string> = {
  pending: 'Unsorted',
  shortlisted: 'Good fit',
  maybe: 'Maybe',
  rejected: 'Not a fit',
}

/** Format an opportunity_position enum value for display: head_coach → "Head Coach". */
function formatPosition(pos: string | null | undefined): string {
  if (!pos) return ''
  return pos.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

interface OwnerApplicant {
  applicant_id: string
  full_name: string | null
  role: string
  avatar_url: string | null
  position: string | null
  secondary_position: string | null
  open_to_play: boolean
  open_to_coach: boolean
  accepted_reference_count: number
  career_entry_count: number
  profile_completeness_pct: number | null
  highlight_video_url: string | null
  current_club: string | null
  nationality_country_id: number | null
  nationality2_country_id: number | null
  triage_status: 'pending' | 'shortlisted' | 'maybe' | 'rejected'
  applied_at: string
  /** Phase 6 (B14) — bio prose scanned for high-signal credentials
   *  (World Cup, NCAA, Pan Am…) that don't surface from structured
   *  career_history alone. */
  bio: string | null
  bio_credentials: string[]
}

interface OwnerOpportunity {
  opportunity_id: string
  title: string
  position: string
  opportunity_type: 'player' | 'coach'
  gender: string | null
  eu_passport_required: boolean
  applicants: OwnerApplicant[]
  triage_breakdown: { pending: number; shortlisted: number; maybe: number; rejected: number }
}

interface CareerHistRow {
  entry_type?: string | null
  club_name?: string | null
  location_country?: string | null
}

/** Fit + strength + completeness — composite is scaled so the higher
 *  signal always dominates the lower (completeness can never flip a
 *  fit/strength ordering, only break a tie). */
function scoreOwnerApplicant(
  a: OwnerApplicant,
  opp: OwnerOpportunity,
  euCountryIds: Set<number>,
  career: CareerHistRow[],
): { fit: number; strength: number; composite: number } {
  let fit = 0
  if (a.position === opp.position || a.secondary_position === opp.position) fit += 3
  if (opp.opportunity_type === 'player' && a.open_to_play) fit += 2
  else if (opp.opportunity_type === 'coach' && a.open_to_coach) fit += 2
  const hasEu = (a.nationality_country_id != null && euCountryIds.has(a.nationality_country_id))
    || (a.nationality2_country_id != null && euCountryIds.has(a.nationality2_country_id))
  if (opp.eu_passport_required && hasEu) fit += 3

  let strength = 0
  strength += Math.min(a.accepted_reference_count * 2, 6)
  if (career.some(c => c.entry_type === 'national_team')) strength += 3
  if (a.current_club) strength += 1
  if (a.career_entry_count >= 3) strength += 1
  if (a.highlight_video_url) strength += 1
  // Phase 6 (B14) — credit bio prose credentials capped at +4, so a
  // decorated bio can lift a thin profile out of "Needs more info" but
  // can't fake a strong score on its own.
  strength += Math.min(a.bio_credentials.length * 2, 4)

  const completeness = a.profile_completeness_pct ?? 0
  // fit dominates (× 1000), then strength (× 10), then completeness — so
  // completeness can break a tie but never flip a fit/strength ordering.
  const composite = fit * 1000 + strength * 10 + completeness / 100
  return { fit, strength, composite }
}

function fitLevelForScore(s: { fit: number; strength: number }): 'strong_match' | 'possible_match' | 'needs_more_info' {
  if (s.fit >= 5 && s.strength >= 3) return 'strong_match'
  if (s.fit >= 3) return 'possible_match'
  return 'needs_more_info'
}

/** Up to 4 bullets per applicant, priority-ordered. Every line is anchored
 *  to a specific data point so the owner can click through and verify. */
function buildRecommendationBullets(
  a: OwnerApplicant,
  opp: OwnerOpportunity,
  euCountryIds: Set<number>,
  career: CareerHistRow[],
): string[] {
  const out: string[] = []
  const push = (s: string) => { if (out.length < 4) out.push(s) }

  // 1. Triage acknowledgment first when not Unsorted — the owner needs to
  //    see we know what they've already labelled.
  if (a.triage_status === 'shortlisted') push('You marked this candidate Good fit')
  else if (a.triage_status === 'maybe') push('Worth a second look — you marked this Maybe')

  // 2. Position match against the opening.
  if (a.position === opp.position) {
    push(`Plays ${formatPosition(a.position)} — matches your ${formatPosition(opp.position)} opening`)
  } else if (a.secondary_position === opp.position) {
    push(`Plays ${formatPosition(a.position)}, can also cover ${formatPosition(opp.position)}`)
  }

  // 3. EU passport when the opening requires it.
  if (opp.eu_passport_required) {
    const hasEu = (a.nationality_country_id != null && euCountryIds.has(a.nationality_country_id))
      || (a.nationality2_country_id != null && euCountryIds.has(a.nationality2_country_id))
    if (hasEu) push('EU passport confirmed — your opening requires one')
  }

  // 4. Availability.
  if (opp.opportunity_type === 'player' && a.open_to_play) push('Open to play')
  else if (opp.opportunity_type === 'coach' && a.open_to_coach) push('Open to coach')

  // 5. National-team selection — strongest pedigree signal.
  const natTeam = career.find(c => c.entry_type === 'national_team' && c.club_name)
  if (natTeam?.club_name) push(`Selected for ${natTeam.club_name}`)

  // 5b. Bio credentials (Phase 6, B14) — World Cup / NCAA / Pan Am
  //     mentions buried in bio prose. Bumps Marcia-style decorated
  //     profiles out of "thin bullets" territory.
  for (const cred of a.bio_credentials) push(cred)

  // 6. Concrete club experience.
  const clubEntry = career.find(c => c.entry_type === 'club' && c.club_name)
  if (clubEntry?.club_name) {
    push(clubEntry.location_country
      ? `Played for ${clubEntry.club_name} in ${clubEntry.location_country}`
      : `Played for ${clubEntry.club_name}`)
  }

  // 7. Verified references.
  if (a.accepted_reference_count > 0) {
    const n = a.accepted_reference_count
    push(`${n} accepted reference${n === 1 ? '' : 's'}`)
  }

  // 8. Current club.
  if (a.current_club) push(`Current club: ${a.current_club}`)

  // 9. Highlight video.
  if (a.highlight_video_url) push('Has a highlight video on profile')

  return out.slice(0, 4)
}

/**
 * One neutral caveat bullet — calls out the most notable signal MISSING on
 * a recommended applicant, so the owner sees what the AI weighed against
 * and what it didn't. Only fires on strong/good matches (a "needs more
 * info" pill already implies gaps). At most one caveat per card.
 */
function buildRecommendationCaveats(
  a: OwnerApplicant,
  fitLevel: 'strong_match' | 'possible_match' | 'needs_more_info',
  career: CareerHistRow[],
  opp: OwnerOpportunity,
): string[] {
  // Production audit B6 — when a position-mismatched applicant surfaces
  // (e.g. a midfielder who applied to a Goalkeeper opening), name it
  // explicitly. This is the first caveat we emit because the owner
  // needs to know immediately why this card looks weak.
  if (opp.opportunity_type === 'player'
      && a.position
      && a.position !== opp.position
      && a.secondary_position !== opp.position) {
    return [`Position mismatch — applied to your ${formatPosition(opp.position)} opening but plays ${formatPosition(a.position)}`]
  }
  if (fitLevel === 'needs_more_info') return []
  if (a.accepted_reference_count === 0) {
    return ['No accepted references on file yet']
  }
  if (!a.highlight_video_url) {
    return ['No highlight video on their profile']
  }
  if (!career.some(c => c.entry_type === 'national_team')) {
    return ['No national-team experience listed']
  }
  if (!a.current_club) {
    return ['No current club listed']
  }
  const pct = a.profile_completeness_pct ?? 100
  if (pct < 40) {
    return [`Profile is ${pct}% complete — still thin overall`]
  }
  return []
}

/** Honest orientation sentence — always includes the full triage breakdown
 *  (Not a fit included even though the ranker excludes them) so the owner
 *  sees what the AI looked at and what it ignored. */
function buildRecruitmentOrientation(opp: OwnerOpportunity): string {
  const b = opp.triage_breakdown
  const total = b.pending + b.shortlisted + b.maybe + b.rejected
  const pool = b.pending + b.shortlisted + b.maybe
  const parts: string[] = []
  if (b.shortlisted > 0) parts.push(`${b.shortlisted} Good fit`)
  if (b.maybe > 0) parts.push(`${b.maybe} Maybe`)
  if (b.pending > 0) parts.push(`${b.pending} Unsorted`)
  if (b.rejected > 0) parts.push(`${b.rejected} Not a fit`)
  const breakdown = parts.join(', ')
  const headline = `For your ${formatPosition(opp.position)} opening, ${total} ${total === 1 ? 'person' : 'people'} applied — ${breakdown}.`
  if (pool === 0) {
    if (b.rejected > 0) {
      return `${headline} All have been marked Not a fit; I won't override that — want me to look outside your pipeline?`
    }
    return headline
  }
  return `${headline} I'm recommending from the ${pool} you haven't ruled out.`
}

/**
 * Try to find the opening the user is asking about from the query text —
 * e.g. "best applicants for the coach opening" should target the coach
 * opening even when the goalkeeper opening would otherwise rank first by
 * best-applicant score. Substring match against each opening's position
 * label paired with a context word ("opening", "applicants", "role").
 */
function findOpeningByQueryPosition(
  query: string,
  opps: OwnerOpportunity[],
): OwnerOpportunity | null {
  const lq = (query || '').toLowerCase()
  // 1. Specific position label first ("head coach opening" beats a plain
  //    "coach opening" if both could match). Skip rows with null position —
  //    Sentry SUPABASE-EDGE-FUNCTIONS-A: every owner query was crashing
  //    here when an opportunity had a null position column (kept happening
  //    even though no rows with status='open' had null at query time —
  //    likely transient or test-seed state). Defensive null guard so the
  //    handler degrades to "no targeted opening" instead of throwing.
  for (const opp of opps) {
    if (!opp.position) continue
    const positionLabel = opp.position.toLowerCase().replace(/_/g, ' ')
    if (lq.includes(`${positionLabel} opening`)
        || lq.includes(`${positionLabel} applicants`)
        || lq.includes(`${positionLabel} role`)
        || lq.includes(`for the ${positionLabel}`)
        || lq.includes(`for my ${positionLabel}`)) {
      return opp
    }
  }
  // 2. Generic opportunity_type fallback — "coach opening" routes to the
  //    first coach-type opp even when its specific position is head_coach
  //    or assistant_coach. ("Player opening" similarly catches any
  //    player-type opp.)
  for (const opp of opps) {
    if (!opp.opportunity_type) continue
    const t = opp.opportunity_type.toLowerCase()
    if (lq.includes(`${t} opening`)
        || lq.includes(`${t} applicants`)
        || lq.includes(`${t} role`)
        || lq.includes(`for the ${t}`)
        || lq.includes(`for my ${t}`)) {
      return opp
    }
  }
  return null
}

/** Extracts the most likely person-name fragment from a "tell me more about X" /
 *  "cuéntame sobre X" follow-up. Returns null when no name-shaped tail follows
 *  the trigger phrase. (B2)
 *  - Capture group requires at least one non-whitespace char so empty tails
 *    can't pass.
 *  - 500-char query cap blocks pathological backtracking.
 *  - Trailing Unicode punctuation stripped via \p{P} so "María—" or "José."
 *    yield clean names. */
function extractApplicantNameFromQuery(query: string): string | null {
  if (!query || query.length > 500) return null
  const m = query.match(/\b(?:tell me|more|details|cu[eé]ntame|cuentame)\s+(?:more\s+|much more\s+|m[aá]s\s+(?:m[aá]s\s+|informaci[oó]n\s+)?)?(?:about|on|regarding|sobre|de|acerca de)\s+(\S[^\n]{0,58})/i)
  if (!m) return null
  const tail = m[1].trim().replace(/[\s\p{P}]+$/u, '')
  if (tail.length < 2 || tail.length > 60) return null
  return tail
}

/** Returns the applicants whose full_name best matches `name`. Match modes,
 *  in order: exact (case-insensitive), full-name contains, single-token
 *  starts-with. Returns [] when no candidate is plausible enough — caller
 *  falls back to the normal recommendation flow. (B2) */
function findApplicantsByName(pool: OwnerApplicant[], name: string): OwnerApplicant[] {
  const n = name.toLowerCase()
  const exact = pool.filter(a => (a.full_name ?? '').toLowerCase() === n)
  if (exact.length) return exact
  const contains = pool.filter(a => (a.full_name ?? '').toLowerCase().includes(n))
  if (contains.length) return contains
  // Single-token starts-with on first or last name.
  if (!n.includes(' ')) {
    const starts = pool.filter(a => {
      const parts = (a.full_name ?? '').toLowerCase().split(/\s+/)
      return parts.some(p => p.startsWith(n))
    })
    if (starts.length) return starts
  }
  return []
}

/** Negative-intent triggers ("who applied but doesn't match", "weak
 *  applicants"). When this fires, the owner handler flips its selection
 *  from strongest-first to mismatched/thin-first. (B7) */
function isNegativeApplicantIntent(query: string): boolean {
  return /\bwho applied (but|and) (do(es)?n'?t|doesn't|don'?t) (match|fit)/i.test(query)
    || /\b(who|which) (applicants? )?(do(es)?n'?t|don'?t) (match|fit)/i.test(query)
    || /\b(weak|poor|mismatched|bad fit) applicants?\b/i.test(query)
    || /\bwho (should|shouldn'?t) i (not |skip|ignore|pass)/i.test(query)
    || /\b(qui[eé]n|qui[eé]nes) (no )?(coincide|encaja|sirve)/i.test(query)
    || /\baplicantes? (d[eé]biles|que no encajan|mal[oa]s)/i.test(query)
}

/** Per-role navigation target for the "Review applicant" CTA. */
function applicantPublicProfilePath(role: string, id: string): string {
  if (role === 'coach') return `/coaches/id/${id}?ref=ai-recommendation`
  if (role === 'umpire') return `/umpires/id/${id}?ref=ai-recommendation`
  if (role === 'club') return `/clubs/id/${id}?ref=ai-recommendation`
  if (role === 'brand') return `/marketplace`
  return `/players/id/${id}?ref=ai-recommendation`
}

/**
 * Phase 5 — recommends top applicants from the owner's own pipeline.
 * Fires only for clubs and coaches that own at least one open opportunity.
 * Edge cases (no opps, no applicants, all rejected, thin data) each get
 * their own honest message rather than a one-size-fits-all fallback.
 */
async function handleOwnApplicantsIntent(params: {
  // deno-lint-ignore no-explicit-any
  adminClient: any
  userId: string
  query: string
  userContext: UserContext | undefined
  llmProvider: string
  startTime: number
  correlationId: string
  headers: Record<string, string>
}): Promise<Response> {
  const { adminClient, userId, query, userContext, llmProvider, startTime, correlationId, headers } = params

  const respond = (envelope: Record<string, unknown>) => {
    fireAndForget(logDiscoveryEvent(adminClient, {
      user_id: userId,
      role: userContext?.role ?? null,
      query_text: query,
      intent: 'search',
      parsed_filters: { _meta: { kind: 'recommendation', handler: 'own_applicants' } } as any,
      result_count: ((envelope.recommendations as unknown[]) ?? []).length,
      has_qualitative: false,
      llm_provider: llmProvider,
      response_time_ms: Date.now() - startTime,
      error_message: null,
      prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0,
      prompt_version: PROMPT_VERSION,
      fallback_used: false, retry_count: 0,
    }))
    return new Response(JSON.stringify({
      success: true,
      data: [],
      total: 0,
      has_more: false,
      parsed_filters: null,
      summary: null,
      applied: null,
      ...envelope,
    }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } })
  }

  try {
    // 1. Owner's open opportunities.
    const { data: oppRows } = await adminClient
      .from('opportunities')
      .select('id, title, position, opportunity_type, gender, eu_passport_required')
      .eq('club_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    if (!oppRows || oppRows.length === 0) {
      return respond({
        kind: 'recommendation' as ResponseKind,
        ai_message: "You don't have any open opportunities yet. Post one and applicants will start coming in.",
        recommendations: [],
        suggested_actions: [
          { label: 'Post an opportunity', intent: { type: 'free_text', query: 'how do I post an opportunity' } },
        ] as SuggestedAction[],
      })
    }

    const oppIds = oppRows.map((o: any) => o.id)

    // 2. Applications + applicant profile data (one batched join).
    const { data: appRows } = await adminClient
      .from('opportunity_applications')
      .select(`
        id, opportunity_id, applicant_id, status, applied_at,
        applicant:profiles!opportunity_applications_applicant_id_fkey(
          id, full_name, role, avatar_url, position, secondary_position,
          open_to_play, open_to_coach, accepted_reference_count,
          career_entry_count, profile_completeness_pct, highlight_video_url,
          current_club, nationality_country_id, nationality2_country_id, bio
        )
      `)
      .in('opportunity_id', oppIds)

    // 3. EU country IDs for the EU-passport bullet/score.
    const { data: euCountries } = await adminClient
      .from('countries').select('id').in('code', EU_PASSPORT_CODES_OWN)
    const euCountryIds = new Set<number>((euCountries ?? []).map((c: any) => c.id))

    // 4. career_history for every applicant — bullets need it.
    const applicantIds = Array.from(new Set(
      ((appRows ?? []) as any[]).map(r => r.applicant_id).filter(Boolean)
    ))
    const careerByUser = new Map<string, CareerHistRow[]>()
    if (applicantIds.length > 0) {
      const { data: careerRows } = await adminClient
        .from('career_history')
        .select('user_id, entry_type, club_name, location_country')
        .in('user_id', applicantIds)
      for (const row of (careerRows ?? []) as Array<CareerHistRow & { user_id: string }>) {
        const arr = careerByUser.get(row.user_id) ?? []
        arr.push(row)
        careerByUser.set(row.user_id, arr)
      }
    }

    // 5. Group applications by opportunity with triage breakdown.
    const oppMap = new Map<string, OwnerOpportunity>()
    for (const o of oppRows as any[]) {
      oppMap.set(o.id, {
        opportunity_id: o.id,
        title: o.title ?? formatPosition(o.position),
        position: o.position,
        opportunity_type: o.opportunity_type,
        gender: o.gender ?? null,
        eu_passport_required: !!o.eu_passport_required,
        applicants: [],
        triage_breakdown: { pending: 0, shortlisted: 0, maybe: 0, rejected: 0 },
      })
    }
    for (const a of (appRows ?? []) as any[]) {
      const opp = oppMap.get(a.opportunity_id)
      if (!opp) continue
      const ap = a.applicant
      if (!ap?.id) continue
      const status = (a.status ?? 'pending') as 'pending' | 'shortlisted' | 'maybe' | 'rejected'
      opp.triage_breakdown[status] = (opp.triage_breakdown[status] ?? 0) + 1
      const bioText = (ap.bio as string | null | undefined) ?? null
      opp.applicants.push({
        applicant_id: ap.id,
        full_name: ap.full_name ?? null,
        role: ap.role,
        avatar_url: ap.avatar_url ?? null,
        position: ap.position ?? null,
        secondary_position: ap.secondary_position ?? null,
        open_to_play: !!ap.open_to_play,
        open_to_coach: !!ap.open_to_coach,
        accepted_reference_count: ap.accepted_reference_count ?? 0,
        career_entry_count: ap.career_entry_count ?? 0,
        profile_completeness_pct: ap.profile_completeness_pct ?? null,
        highlight_video_url: ap.highlight_video_url ?? null,
        current_club: ap.current_club ?? null,
        nationality_country_id: ap.nationality_country_id ?? null,
        nationality2_country_id: ap.nationality2_country_id ?? null,
        triage_status: status,
        applied_at: a.applied_at,
        bio: bioText,
        bio_credentials: detectBioCredentials(bioText),
      })
    }

    const allOpps = Array.from(oppMap.values())
    const totalApplicantsAcrossAll = allOpps.reduce((s, o) => s + o.applicants.length, 0)

    // Edge: no one has applied to anything yet.
    if (totalApplicantsAcrossAll === 0) {
      const first = allOpps[0]
      const noun = formatPosition(first.position).toLowerCase()
      return respond({
        kind: 'recommendation' as ResponseKind,
        ai_message: `No one has applied to your ${formatPosition(first.position)} opening yet. Want me to suggest strong ${noun}s you could invite?`,
        recommendations: [],
        suggested_actions: [
          { label: `Find ${noun}s to invite`, intent: { type: 'free_text', query: `find me ${noun}s` } },
        ] as SuggestedAction[],
      })
    }

    // 6. Per-opening ranking. Pool = pending + shortlisted + maybe.
    const oppRanked = allOpps.map(opp => {
      const pool = opp.applicants.filter(a => a.triage_status !== 'rejected')
      const scored = pool.map(a => {
        const career = careerByUser.get(a.applicant_id) ?? []
        const score = scoreOwnerApplicant(a, opp, euCountryIds, career)
        const bullets = buildRecommendationBullets(a, opp, euCountryIds, career)
        return { applicant: a, score, bullets, fit_level: fitLevelForScore(score) }
      }).sort((x, y) => y.score.composite - x.score.composite)
      return { opp, scored, bestScore: scored[0]?.score.composite ?? 0, pool }
    })

    // Sort openings by BEST APPLICANT QUALITY first (not pending volume — an
    // opening with 20 weak applicants must not outrank one with 3 strong
    // ones). Tiebreaks: pending volume, then longest-waiting pending date.
    oppRanked.sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore
      const aPend = a.opp.triage_breakdown.pending
      const bPend = b.opp.triage_breakdown.pending
      if (bPend !== aPend) return bPend - aPend
      const aOld = a.opp.applicants.filter(x => x.triage_status === 'pending')
        .reduce((min, x) => Math.min(min, new Date(x.applied_at).getTime()), Infinity)
      const bOld = b.opp.applicants.filter(x => x.triage_status === 'pending')
        .reduce((min, x) => Math.min(min, new Date(x.applied_at).getTime()), Infinity)
      return aOld - bOld
    })

    // Allow the user to disambiguate explicitly — if the query mentions a
    // specific opening's position ("best applicants for the coach
    // opening"), that wins over the best-applicant ranking. Otherwise the
    // highest-best-applicant opening is primary.
    let primary = oppRanked[0]
    const targeted = findOpeningByQueryPosition(query, allOpps)
    if (targeted) {
      const idx = oppRanked.findIndex(r => r.opp.opportunity_id === targeted.opportunity_id)
      if (idx >= 0) primary = oppRanked[idx]
    } else if (oppRanked.length > 1
        && /\b(other|second|next)\s+(opening|one|role)\b/i.test(query)) {
      // Production audit B1 — natural-language follow-up ("show me the
      // other opening") that didn't click a chip. With 2+ openings,
      // "other / second / next opening" routes to the second-best opp.
      primary = oppRanked[1]
    }

    // Edge: primary opening's pool is empty (everyone marked Not a fit).
    // The orientation already explains the situation; no cards.
    if (primary.pool.length === 0) {
      const noun = formatPosition(primary.opp.position).toLowerCase()
      return respond({
        kind: 'recommendation' as ResponseKind,
        ai_message: buildRecruitmentOrientation(primary.opp),
        recommendations: [],
        suggested_actions: [
          { label: `Find ${noun}s outside this pipeline`, intent: { type: 'free_text', query: `find ${noun}s` } },
        ] as SuggestedAction[],
      })
    }

    // Phase 6 (B2) — conversational "tell me more about <name>" follow-up.
    // Look the name up across every opening's pool (the user may be asking
    // about someone outside the current primary). If we find a single
    // match, render that one applicant's card. If 2-3 plausible matches,
    // render all of them so the user can disambiguate. Unmatched names
    // fall through to the normal ranked-recommendations flow below.
    const nameFromQuery = extractApplicantNameFromQuery(query)
    if (nameFromQuery) {
      const allPool: { applicant: OwnerApplicant; opp: OwnerOpportunity }[] = []
      for (const r of oppRanked) {
        for (const a of r.pool) allPool.push({ applicant: a, opp: r.opp })
      }
      const matched = findApplicantsByName(allPool.map(x => x.applicant), nameFromQuery)
      if (matched.length > 0 && matched.length <= 3) {
        const matchedCards = matched.map(applicant => {
          const oppForApp = allPool.find(x => x.applicant.applicant_id === applicant.applicant_id)!.opp
          const career = careerByUser.get(applicant.applicant_id) ?? []
          const score = scoreOwnerApplicant(applicant, oppForApp, euCountryIds, career)
          const fit_level = fitLevelForScore(score)
          return {
            applicant_id: applicant.applicant_id,
            applicant_name: applicant.full_name,
            applicant_role: applicant.role,
            applicant_avatar_url: applicant.avatar_url,
            opening_id: oppForApp.opportunity_id,
            opening_title: oppForApp.title,
            opening_position: oppForApp.position,
            triage: applicant.triage_status,
            triage_label: TRIAGE_LABEL[applicant.triage_status] ?? applicant.triage_status,
            fit_level,
            bullets: buildRecommendationBullets(applicant, oppForApp, euCountryIds, career),
            caveats: buildRecommendationCaveats(applicant, fit_level, career, oppForApp),
            navigate_to: applicantPublicProfilePath(applicant.role, applicant.applicant_id),
          }
        })
        const headline = matched.length === 1
          ? `Here's what I have on ${matched[0].full_name ?? nameFromQuery} for your ${formatPosition(matchedCards[0].opening_position)} opening.`
          : `I found ${matched.length} applicants matching "${nameFromQuery}" — open any to see the full profile.`
        return respond({
          kind: 'recommendation' as ResponseKind,
          ai_message: headline,
          recommendations: matchedCards,
          suggested_actions: [
            { label: 'Back to top applicants', intent: { type: 'free_text', query: 'show my best applicants' } },
          ] as SuggestedAction[],
        })
      }
      // No plausible match — keep going; the normal flow will hand back the
      // ranked recommendations and the user can rephrase.
    }

    // Phase 6 (B7) — negative-intent ("who applied but doesn't match",
    // "weak applicants"). Flip selection inside primary.pool to the
    // mismatched / thin candidates: position mismatch first, then
    // strength = 0 / "needs_more_info" tier. Caveats already explain the
    // mismatch, so the existing card render is enough.
    const negativeIntent = isNegativeApplicantIntent(query)

    // 7. Cards from the primary opening. Default cap is 2 ("show me the
    //    best"); lifted to 10 when the user explicitly asks for all/every/
    //    rank-all (production audit B3 — bare cap of 2 hid the long tail).
    const wantAll = /\b(all|every|each)\s+(my\s+)?(applicants?|candidates?|aplicantes|candidatos)\b/i.test(query)
      || /\brank\b/i.test(query)
      || /\b(show|surface) (me )?(all|every|the rest)\b/i.test(query)
      || /\bm[aá]s (aplicantes|candidatos|opciones)\b/i.test(query)
    const cap = wantAll ? 10 : 2

    // Negative-intent re-sort: mismatched-position first (highest "wrong"
    // signal), then weakest fit/strength. Default path stays composite-desc.
    const sortedScored = negativeIntent
      ? [...primary.scored].sort((x, y) => {
          const xMismatch = x.applicant.position !== primary.opp.position
            && x.applicant.secondary_position !== primary.opp.position ? 1 : 0
          const yMismatch = y.applicant.position !== primary.opp.position
            && y.applicant.secondary_position !== primary.opp.position ? 1 : 0
          if (xMismatch !== yMismatch) return yMismatch - xMismatch
          return x.score.composite - y.score.composite
        })
      : primary.scored

    const recommendations = sortedScored.slice(0, cap).map(s => {
      const career = careerByUser.get(s.applicant.applicant_id) ?? []
      return {
        applicant_id: s.applicant.applicant_id,
        applicant_name: s.applicant.full_name,
        applicant_role: s.applicant.role,
        applicant_avatar_url: s.applicant.avatar_url,
        opening_id: primary.opp.opportunity_id,
        opening_title: primary.opp.title,
        opening_position: primary.opp.position,
        triage: s.applicant.triage_status,
        triage_label: TRIAGE_LABEL[s.applicant.triage_status] ?? s.applicant.triage_status,
        fit_level: s.fit_level,
        bullets: s.bullets,
        caveats: buildRecommendationCaveats(s.applicant, s.fit_level, career, primary.opp),
        navigate_to: applicantPublicProfilePath(s.applicant.role, s.applicant.applicant_id),
      }
    })

    // 8. Secondary openings — any opening that's NOT the primary AND has at
    //    least one non-rejected applicant. The nudge text describes them in
    //    aggregate; the chips below wire it to actual handler runs so a
    //    "yes" reply has something to hook into (production audit: the
    //    nudge used to be a "dead promise" the AI couldn't fulfil).
    const secondaryOpps = oppRanked
      .filter(o => o.opp.opportunity_id !== primary.opp.opportunity_id && o.pool.length > 0)
    let secondary_note: string | null = null
    if (secondaryOpps.length === 1) {
      const o = secondaryOpps[0].opp
      const n = secondaryOpps[0].pool.length
      secondary_note = `You also have ${n} ${n === 1 ? 'applicant' : 'applicants'} on your ${formatPosition(o.position)} opening — want me to surface those next?`
    } else if (secondaryOpps.length > 1) {
      const totalSec = secondaryOpps.reduce((s, o) => s + o.pool.length, 0)
      secondary_note = `You also have ${totalSec} applicants across ${secondaryOpps.length} other openings — want me to look at them too?`
    }

    // Explicit "Show {position} applicants" chips — one per secondary
    // opening, capped at 3. Each chip's query is shaped so the
    // findOpeningByQueryPosition lookup above re-fires the handler
    // targeting that specific opening.
    const secondaryChips: SuggestedAction[] = secondaryOpps.slice(0, 3).map(o => {
      const posLabel = formatPosition(o.opp.position)
      return {
        label: `Show ${posLabel} applicants`,
        intent: { type: 'free_text', query: `Show me applicants for my ${posLabel.toLowerCase()} opening` },
      }
    })

    // Honest about thin data on the recommendations.
    const thinData = primary.scored.slice(0, 2).some(s => (s.applicant.profile_completeness_pct ?? 0) < 30)
    const lowDataNote = thinData
      ? ` Some of these profiles are still thin — I've called out what's there, not what's missing.`
      : ''

    // B7 — when the user asked for the negative cut, lead with the reverse
    // framing so the cards aren't misread as "top picks". Owner sees both
    // the headline (pool view) and what they're now looking at.
    const aiMessage = negativeIntent
      ? `${buildRecruitmentOrientation(primary.opp)} You asked who doesn't fit — leading with the position mismatches and weakest profiles.${lowDataNote}`
      : buildRecruitmentOrientation(primary.opp) + lowDataNote

    return respond({
      kind: 'recommendation' as ResponseKind,
      ai_message: aiMessage,
      recommendations,
      secondary_note,
      suggested_actions: secondaryChips,
    })
  } catch (err) {
    // B0 diagnostic instrumentation — capture the real error message + stack so
    // the next prod failure shows up in Supabase function logs (stderr capture)
    // and the correlationId can be correlated with Sentry. Remove once B0 is
    // root-caused and fixed.
    const errMessage = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? err.stack : undefined
    console.error(`[nl-search][own_applicants][${correlationId}] ${errMessage}\n${errStack ?? ''}`)
    captureException(err, { functionName: 'nl-search', correlationId, extra: { phase: 'own_applicants', error_message: errMessage } })
    return respond({
      kind: 'soft_error' as ResponseKind,
      ai_message: `I had trouble pulling your recruitment data just now. Try again in a moment. (ref ${correlationId})`,
      recommendations: [],
      suggested_actions: [{ label: 'Try again', intent: { type: 'retry' } }] as SuggestedAction[],
    })
  }
}

/** Graceful degradation: the LLM parse failed (timeout, transient error, or
 *  provider quota). Re-use the user's raw query as full-text input to the
 *  existing discover_profiles RPC so the user still gets results. */
async function runKeywordFallback(params: {
  // deno-lint-ignore no-explicit-any
  adminClient: any
  rawQuery: string
  userId: string
  userRole: string | null
  startTime: number
  llmProvider: string
  originalError: Error
  parseRetryCount: number
  headers: Record<string, string>
  correlationId: string
  /** PR-4 — when the previous turn was already soft_error, the terminal
   *  soft-error path uses alternate copy + chip set to avoid showing the
   *  same "I had trouble" message twice. */
  isRepeatSoftError: boolean
  /** Phase 1b — "Show more" load-more offset; pages past results already shown. */
  offset: number
}): Promise<Response> {
  const { adminClient, rawQuery, userId, userRole, startTime, llmProvider, originalError, parseRetryCount, headers, correlationId, isRepeatSoftError, offset } = params

  try {
    const discoverableRoles = ['player', 'coach', 'club', 'brand']
    // Pass p_coach_specializations explicitly (even as null) so PostgREST can
    // disambiguate against the older overload of discover_profiles. Without
    // this the staging DB returns PGRST203 ("Could not choose the best
    // candidate function") because two overloaded signatures exist. Pre-
    // existing bug surfaced by Phase 1A testing.
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('discover_profiles', {
      p_roles: discoverableRoles,
      p_search_text: rawQuery,
      p_sort_by: 'relevance',
      p_limit: offset > 0 ? DEFAULT_RESULT_LIMIT : resolveResultLimit(rawQuery),
      p_offset: offset,
      p_coach_specializations: null,
    })

    if (rpcError) throw rpcError

    const result = (rpcResult as { results: any[]; total: number; has_more: boolean } | null)
      ?? { results: [], total: 0, has_more: false }

    fireAndForget(logDiscoveryEvent(adminClient, {
      user_id: userId,
      role: userRole,
      query_text: rawQuery,
      intent: 'search_fallback',
      parsed_filters: null,
      result_count: result.total,
      has_qualitative: false,
      llm_provider: llmProvider,
      response_time_ms: Date.now() - startTime,
      error_message: originalError.message,
      prompt_tokens: null,
      completion_tokens: null,
      cached_tokens: null,
      prompt_version: PROMPT_VERSION,
      fallback_used: true,
      retry_count: parseRetryCount,
    }))

    // Phase 3e — actionable fallback UX. Rate-limit / timeout errors are
    // transient (Gemini free tier hits its quota during dense use), so the
    // user benefits from a Retry chip + a clearer message that explains the
    // situation. Other LLM errors (parse, network) get the original copy.
    const isTransientLlmError =
      originalError.message === 'AI_RATE_LIMIT' || originalError.message === 'AI_TIMEOUT'
    const fallbackMessage = isTransientLlmError
      ? (result.total === 0
          ? "The AI search is busy right now and I couldn't find a quick keyword match. Try again in a moment, or rephrase your search."
          : "The AI search is busy right now — here are some keyword matches in the meantime. Try again in a moment for the full AI response.")
      : (result.total === 0
          ? "I couldn't complete the full AI response and didn't find a quick match either."
          : "I couldn't complete the full AI response, but here are some relevant matches.")
    const fallbackActions: SuggestedAction[] = isTransientLlmError
      ? [{ label: 'Try again', intent: { type: 'retry' } }]
      : []
    return new Response(
      JSON.stringify({
        success: true,
        data: result.results,
        total: result.total,
        has_more: result.has_more,
        parsed_filters: null,
        summary: `Showing ${result.total} keyword match${result.total === 1 ? '' : 'es'}.`,
        ai_message: fallbackMessage,
        kind: (result.total === 0 ? 'no_results' : 'results') as ResponseKind,
        applied: null,
        suggested_actions: fallbackActions,
      }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  } catch (fallbackError) {
    captureException(fallbackError, { functionName: 'nl-search', correlationId, extra: { phase: 'fallback' } })
    // Surface the actual fallback failure reason. supabase-js returns
    // PostgrestError as a plain object (with `message`, `code`, `details`,
    // `hint`) — `instanceof Error` is false for those, so the previous
    // "unknown" string was hiding the real diagnostic. Walk the common
    // shapes (Error, PostgrestError-like, plain string, JSON-stringify)
    // to keep the discovery_events row meaningful.
    const describeError = (e: unknown): string => {
      if (e instanceof Error) return e.message
      if (typeof e === 'string') return e
      if (e && typeof e === 'object') {
        const o = e as { message?: string; code?: string; details?: string; hint?: string }
        const parts: string[] = []
        if (o.code) parts.push(`code=${o.code}`)
        if (o.message) parts.push(o.message)
        if (o.details) parts.push(`details=${o.details}`)
        if (o.hint) parts.push(`hint=${o.hint}`)
        if (parts.length > 0) return parts.join(' ')
        try { return JSON.stringify(e) } catch { return 'unserializable' }
      }
      return String(e)
    }
    fireAndForget(logDiscoveryEvent(adminClient, {
      user_id: userId,
      role: userRole,
      query_text: rawQuery,
      intent: 'error',
      parsed_filters: null,
      result_count: 0,
      has_qualitative: false,
      llm_provider: llmProvider,
      response_time_ms: Date.now() - startTime,
      error_message: `${originalError.message} | fallback: ${describeError(fallbackError)}`,
      prompt_tokens: null,
      completion_tokens: null,
      cached_tokens: null,
      prompt_version: PROMPT_VERSION,
      fallback_used: true,
      retry_count: parseRetryCount,
    }))
    // PR-3/PR-4: doubly-degraded fallback — both the LLM and the keyword
    // RPC failed. Return 200 + kind=soft_error with alternate copy when
    // the previous turn was also a soft_error so the user doesn't see the
    // same "I had trouble" message twice.
    const softErrorActions = isRepeatSoftError ? getRepeatedSoftErrorActions() : getSoftErrorActions()
    const softErrorMessage = isRepeatSoftError
      ? "That still didn't go through. Let's try a simpler path."
      : "I had trouble completing that search. Want to try again or broaden it?"
    return new Response(
      JSON.stringify({
        success: true,
        data: [],
        total: 0,
        has_more: false,
        parsed_filters: null,
        summary: null,
        ai_message: softErrorMessage,
        kind: 'soft_error' as ResponseKind,
        applied: null,
        suggested_actions: softErrorActions,
      }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }
}

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const origin = req.headers.get('origin')
  const headers = getCorsHeaders(origin)
  const startTime = Date.now()
  const llmProvider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  // Hoisted state for catch-block fallback. Set as the handler validates each
  // prerequisite; the catch uses them to decide whether a keyword fallback is
  // feasible (needs at least a validated query + user + admin client).
  // deno-lint-ignore no-explicit-any
  let pendingAdminClient: any = null
  let pendingUserId: string | null = null
  let pendingUserRole: string | null = null
  let pendingQuery: string | null = null
  // Phase 1b — "Show more" offset, carried into the keyword-fallback path.
  let pendingOffset = 0
  // PR-4: track whether the previous turn was already soft_error so the
  // catch-block fallback can emit alternate copy on a repeated failure.
  let pendingIsRepeatSoftError = false
  // PR-4 QA fix: keyword fallback only makes sense for search-shaped intents.
  // For knowledge / self_advice / greeting queries, the keyword RPC returns
  // 0 matches and the user sees a no_results card with totally unrelated
  // chips. Track the routed intent so the catch block can emit a clean
  // soft_error instead of running the wrong fallback.
  let pendingIntentEntityType: string | null = null

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers })
  }

  // Method check
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // ── Auth ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.slice(7)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )

    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication failed' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ── Rate limit ──────────────────────────────────────────────────────
    const adminClient = getServiceClient()

    const { data: rateData } = await adminClient.rpc('check_rate_limit', {
      p_identifier: user.id,
      p_action_type: 'nl_search',
      p_max_requests: 30,
      p_window_seconds: 60,
    })

    const rateResult = rateData as { allowed: boolean; remaining: number; reset_at: string } | null
    if (rateResult && !rateResult.allowed) {
      const retryAfter = Math.max(1, Math.ceil(
        (new Date(rateResult.reset_at).getTime() - Date.now()) / 1000
      ))
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Please slow down.' }),
        { status: 429, headers: { ...headers, 'Retry-After': String(retryAfter), 'Content-Type': 'application/json' } }
      )
    }

    // ── Parse body ──────────────────────────────────────────────────────
    const body = await req.json()
    const query = body?.query?.trim()
    // Phase 1b — "Show more": a load-more request carries an offset so the
    // search pages past results already shown. Capped to a sane ceiling.
    const requestedOffset = Number.isInteger(body?.offset) && body.offset > 0
      ? Math.min(body.offset, 500)
      : 0
    // Phase 4 — IDs of profiles the user has already seen in this chat.
    // Filtered out post-RPC so a follow-up like "show me different
    // players" returns genuinely new faces, not a re-shuffle of the
    // first answer. Capped to keep the request body small.
    const excludedIds: string[] = Array.isArray(body?.excluded_ids)
      ? (body.excluded_ids as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .slice(0, 50)
      : []
    const rawHistory = Array.isArray(body?.history) ? body.history : []
    const history: HistoryTurn[] = rawHistory
      .slice(-10)
      .filter((t: any) => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.content === 'string')
    // PR-3 — recovery_context lets the backend detect "the last turn failed,
    // this is a recovery follow-up" without re-running the LLM. The frontend
    // populates it from the most recent assistant message's kind / applied
    // when that kind was no_results or soft_error.
    const rawRecoveryContext: {
      last_kind?: ResponseKind
      last_applied?: AppliedSearch | null
      user_role?: string | null
    } | undefined = body?.recovery_context

    // Adversarial-review fix: client-supplied recovery_context fields are NOT
    // trusted verbatim. We:
    //   1. Whitelist user_role against the known role set (else null).
    //   2. Sanitize role_summary by stripping HTML tags and capping length
    //      (defense-in-depth; today React escapes text, but a future
    //      markdown renderer would not).
    // This prevents telemetry pollution from spoofed roles and prevents raw
    // markup from showing up in user-visible copy.
    const ALLOWED_ROLES = new Set(['player', 'coach', 'club', 'brand', 'umpire'])
    const safeUserRole: string | null =
      rawRecoveryContext?.user_role && ALLOWED_ROLES.has(rawRecoveryContext.user_role)
        ? rawRecoveryContext.user_role
        : null
    function sanitizeRoleSummary(s: string | undefined | null): string | null {
      if (!s || typeof s !== 'string') return null
      const cleaned = s.replace(/<[^>]*>/g, '').replace(/[\r\n]/g, ' ').trim()
      if (cleaned.length === 0 || cleaned.length > 80) return null
      return cleaned
    }
    const safeLastApplied: AppliedSearch | null = rawRecoveryContext?.last_applied
      ? {
          ...rawRecoveryContext.last_applied,
          role_summary: sanitizeRoleSummary(rawRecoveryContext.last_applied.role_summary) ?? '',
        }
      : null
    const recoveryContext = rawRecoveryContext
      ? {
          last_kind: rawRecoveryContext.last_kind,
          last_applied: safeLastApplied,
          user_role: safeUserRole,
        }
      : undefined

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or empty query' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    if (query.length > 500) {
      return new Response(
        JSON.stringify({ success: false, error: 'Query too long (max 500 characters)' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // All prerequisites validated — record state so the catch block can
    // attempt a keyword fallback if the LLM call fails downstream.
    pendingAdminClient = adminClient
    pendingUserId = user.id
    pendingQuery = query
    pendingOffset = requestedOffset
    pendingIsRepeatSoftError = recoveryContext?.last_kind === 'soft_error'

    // ── Phase 1A force-soft-error debug (PR-4, staging-only) ───────────
    // Lets the QA spec render <SoftErrorCard /> on the live UI without
    // having to actually break the LLM. Default-deny: debug is allowed
    // ONLY when an explicit staging signal is present.
    //
    //   1. SUPABASE_URL contains the staging project ref, OR
    //   2. SENTRY_ENVIRONMENT is explicitly "staging" or "development"
    //
    // If neither signal is present (env misconfigured, fresh prod project,
    // anything ambiguous), debug is OFF. PUBLIC_SITE_URL is checked only as
    // a hard *production* gate — if it ever matches inhockia.com, debug is
    // forced off regardless of the other signals.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const sentryEnv = (Deno.env.get('SENTRY_ENVIRONMENT') ?? '').toLowerCase()
    const publicSiteUrl = Deno.env.get('PUBLIC_SITE_URL') ?? ''
    const isProductionSignal =
      publicSiteUrl.includes('inhockia.com') ||
      sentryEnv === 'production' ||
      supabaseUrl.includes('xtertgftujnebubxgqit') // hard-coded prod ref
    const isStagingSignal =
      supabaseUrl.includes('ivjkdaylalhsteyyclvl') || // hard-coded staging ref
      sentryEnv === 'staging' ||
      sentryEnv === 'development'
    const debugAllowed = isStagingSignal && !isProductionSignal
    if (debugAllowed && query === '__force_soft_error') {
      const isRepeat = recoveryContext?.last_kind === 'soft_error'
      const softErrorActions = isRepeat ? getRepeatedSoftErrorActions() : getSoftErrorActions()
      const softErrorMessage = isRepeat
        ? "That still didn't go through. Let's try a simpler path."
        : "I had trouble completing that search. Want to try again or broaden it?"
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: recoveryContext?.user_role ?? null,
        query_text: query,
        intent: 'error',
        parsed_filters: { _meta: { kind: 'soft_error', error_phase: 'force_debug', repeated: isRepeat, suggested_actions_count: softErrorActions.length } } as any,
        result_count: 0,
        has_qualitative: false,
        llm_provider: llmProvider,
        response_time_ms: Date.now() - startTime,
        error_message: 'force_soft_error debug query',
        prompt_tokens: 0,
        completion_tokens: 0,
        cached_tokens: 0,
        prompt_version: PROMPT_VERSION,
        fallback_used: false,
        retry_count: 0,
      }))
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          total: 0,
          has_more: false,
          parsed_filters: null,
          summary: null,
          ai_message: softErrorMessage,
          kind: 'soft_error' as ResponseKind,
          applied: null,
          suggested_actions: softErrorActions,
        }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ── Phase 1A recovery short-circuit (PR-3) ─────────────────────────
    // When the previous turn was no_results or soft_error AND the new query
    // is a recovery-shaped follow-up ("what should I do?", "so what now?",
    // "ok"), bypass the LLM entirely and return a deterministic recovery
    // response with chips tailored to the failed search context. Cost ~0
    // tokens, ~50ms response.
    //
    // Both conditions required: just having recovery_context isn't enough
    // (the user might be asking a substantive new question), and the query
    // shape alone isn't enough either (without a prior failure we don't
    // know what to recover from).
    const RECOVERY_KINDS: ResponseKind[] = ['no_results', 'soft_error']
    if (
      recoveryContext?.last_kind &&
      RECOVERY_KINDS.includes(recoveryContext.last_kind) &&
      detectRecoveryQuery(query)
    ) {
      const lastApplied = recoveryContext.last_applied ?? null
      const recoveryRole = recoveryContext.user_role ?? null
      const recoveryActions = getRecoveryActions(lastApplied, recoveryRole)
      const recoveryMessage = lastApplied?.role_summary
        ? `Since the ${lastApplied.role_summary} search didn't find anything, here are the next angles to try:`
        : "Let's try a different angle — pick one of these to keep going:"

      const recoveryMeta = {
        _meta: {
          kind: 'no_results' as ResponseKind,
          recovery_short_circuit: true,
          recovery_from_kind: recoveryContext.last_kind,
          applied_role_summary: lastApplied?.role_summary ?? null,
          suggested_actions_count: recoveryActions.length,
        },
      }
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: recoveryRole,
        query_text: query,
        intent: 'recovery_redirect',
        parsed_filters: recoveryMeta as any,
        result_count: 0,
        has_qualitative: false,
        llm_provider: llmProvider,
        response_time_ms: Date.now() - startTime,
        error_message: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        cached_tokens: 0,
        prompt_version: PROMPT_VERSION,
        fallback_used: false,
        retry_count: 0,
      }))

      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          total: 0,
          has_more: false,
          parsed_filters: null,
          summary: null,
          ai_message: recoveryMessage,
          // Render as a no_results card on the frontend — same component,
          // chips drawn from getRecoveryActions (rotated lead vs the
          // original no_results so the user sees a fresh first option).
          kind: 'no_results' as ResponseKind,
          applied: lastApplied,
          suggested_actions: recoveryActions,
        }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ── Phase 1A clarifying-question short-circuit (PR-4) ──────────────
    // Vague queries like "Find people" / "Show me options" / "Any
    // recommendations?" need a focused 4-option pill row, not a generic
    // LLM paragraph or a fallthrough that searches all 4 roles. Detector
    // is tight (long-form queries belong to the LLM); when it fires we
    // bypass the LLM entirely and ship clarifying_options directly.
    //
    // Note: detector requires a recoveryContext.user_role for role-aware
    // options. If user_role is missing we fall back to generic option set.
    const clarifyingNeed = detectClarifyingNeed(query, recoveryContext?.user_role ?? null)
    if (clarifyingNeed) {
      const clarifyingMeta = {
        _meta: {
          kind: 'clarifying_question' as ResponseKind,
          clarifying_short_circuit: true,
          options_count: clarifyingNeed.options.length,
        },
      }
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: recoveryContext?.user_role ?? null,
        query_text: query,
        intent: 'clarifying_redirect',
        parsed_filters: clarifyingMeta as any,
        result_count: 0,
        has_qualitative: false,
        llm_provider: llmProvider,
        response_time_ms: Date.now() - startTime,
        error_message: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        cached_tokens: 0,
        prompt_version: PROMPT_VERSION,
        fallback_used: false,
        retry_count: 0,
      }))

      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          total: 0,
          has_more: false,
          parsed_filters: null,
          summary: null,
          ai_message: clarifyingNeed.message,
          kind: 'clarifying_question' as ResponseKind,
          applied: null,
          // Frontend's <ClarifyingQuestionCard /> reads clarifying_options.
          // suggested_actions is empty — the question's options are the chips.
          suggested_actions: [] as SuggestedAction[],
          clarifying_options: clarifyingNeed.options as ClarifyingOption[],
        }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ── Phase 0 intent routing ─────────────────────────────────────────
    // Deterministic keyword router runs BEFORE the LLM. For HIGH-confidence
    // queries (e.g. "find clubs for me"), the backend will ENFORCE the
    // entity type after the LLM call, regardless of what the LLM extracts —
    // this fixes the "asked for clubs, got mixed players/coaches/clubs/brands"
    // bug. The hint is also passed to the LLM as a system-prompt nudge so
    // it filters and writes its message accordingly.
    const intent: RoutedIntent = classifyEntityType(query)
    pendingIntentEntityType = intent.entity_type

    // ── Fetch user context for LLM ─────────────────────────────────────
    // Phase 1 personalization: pull a richer slice of the user's own profile
    // (still public/visible-to-self data only — no DMs, admin notes, or
    // private settings) so the LLM can answer "who am I?" / "what should I
    // improve?" / role-specific next-action questions without inventing data.
    let userContext: UserContext | undefined

    try {
      // NOTE — eu_passport is NOT a column on profiles. discover_profiles
      // computes it dynamically when filtering, but does NOT return it in
      // result rows. We mirror that derivation below using EU_PASSPORT_CODES
      // (declared at module scope so the shortlist builder can reuse it).
      const { data: userProfile, error: profileFetchError } = await adminClient
        .from('profiles')
        .select(`
          role, full_name, gender, position, secondary_position,
          playing_category, coaching_categories, umpiring_categories,
          date_of_birth,
          base_city, base_country_id,
          nationality_country_id, nationality2_country_id,
          current_club, current_world_club_id,
          open_to_play, open_to_coach, open_to_opportunities,
          bio, avatar_url, highlight_video_url,
          coach_specialization, coach_specialization_custom,
          onboarding_completed
        `)
        .eq('id', user.id)
        .single()

      // Surface schema-level fetch errors so a stale SELECT (e.g. column
      // renamed/dropped) doesn't silently nuke the entire personalization
      // context — the catch below would swallow it and the LLM would fall
      // back to generic answers with no signal.
      if (profileFetchError) {
        captureException(profileFetchError, {
          functionName: 'nl-search',
          correlationId,
          extra: { phase: 'user-context-profile-select' },
        })
      }

      if (userProfile) {
        const countryIds = [
          userProfile.base_country_id,
          userProfile.nationality_country_id,
          userProfile.nationality2_country_id,
        ].filter(Boolean)

        // Role-specific aggregate fetches run in parallel with country/club
        // resolution. Each is null-safe; failures degrade to 0/null rather
        // than blocking the whole user-context build.
        const [
          countriesRes,
          clubRes,
          friendCountRes,
          referenceCountRes,
          careerCountRes,
          galleryCountRes,
          // Club-only — empty rows when role !== 'club'
          openVacanciesRes,
          pendingApplicationsRes,
          // Brand-only — null when role !== 'brand'
          brandRes,
        ] = await Promise.all([
          countryIds.length > 0
            ? adminClient.from('countries').select('id, name, code').in('id', countryIds)
            : Promise.resolve({ data: [] }),
          userProfile.current_world_club_id
            ? adminClient
                .from('world_clubs')
                .select(`
                  club_name,
                  men_league:world_leagues!world_clubs_men_league_id_fkey(name),
                  women_league:world_leagues!world_clubs_women_league_id_fkey(name),
                  country:countries!world_clubs_country_id_fkey(name)
                `)
                .eq('id', userProfile.current_world_club_id)
                .single()
            : Promise.resolve({ data: null }),
          // Friendships: count rows where the user is on either side and accepted
          adminClient
            .from('profile_friendships')
            .select('id', { count: 'exact', head: true })
            .or(`user_one.eq.${user.id},user_two.eq.${user.id}`)
            .eq('status', 'accepted'),
          // References — accepted endorsements the user has RECEIVED.
          // In profile_references the schema is requester_id = the endorsee
          // (subject of the endorsement), reference_id = the endorser. So we
          // filter on requester_id to match the "references received" semantic
          // exposed everywhere else (discover_profiles.accepted_reference_count,
          // BrandProfilePage breadcrumb counts, etc.).
          adminClient
            .from('profile_references')
            .select('id', { count: 'exact', head: true })
            .eq('requester_id', user.id)
            .eq('status', 'accepted'),
          // Career history entries the user has added
          adminClient
            .from('career_history')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          // Gallery photos the user has uploaded
          adminClient
            .from('gallery_photos')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          // Club-specific: open vacancies posted by this club
          userProfile.role === 'club'
            ? adminClient
                .from('opportunities')
                .select('id', { count: 'exact', head: true })
                .eq('club_id', user.id)
                .eq('status', 'open')
            : Promise.resolve({ count: 0 }),
          // Club-specific: pending applications across this club's vacancies.
          // Inner-join filter on opportunities.club_id keeps this in one round
          // trip without a dedicated RPC.
          userProfile.role === 'club'
            ? adminClient
                .from('opportunity_applications')
                .select('id, opportunities!inner(club_id)', { count: 'exact', head: true })
                .eq('opportunities.club_id', user.id)
                .eq('status', 'pending')
            : Promise.resolve({ count: 0 }),
          // Brand-specific: this user's owned brand record
          userProfile.role === 'brand'
            ? adminClient
                .from('brands')
                .select('id, category, is_verified')
                .eq('profile_id', user.id)
                .is('deleted_at', null)
                .single()
            : Promise.resolve({ data: null }),
        ])

        const countryMap = new Map(
          ((countriesRes.data || []) as any[]).map((c: any) => [c.id, c.name])
        )

        // EU passport eligibility — mirror discover_profiles' derivation from
        // nationality codes. Uses the module-level EU_PASSPORT_CODES set
        // (single source of truth for both the user-context build below and
        // the per-row shortlist build later).
        const codeForId = new Map(
          ((countriesRes.data || []) as any[]).map((c: any) => [c.id, c.code])
        )
        const euPassport =
          (userProfile.nationality_country_id !== null && EU_PASSPORT_CODES.has(codeForId.get(userProfile.nationality_country_id))) ||
          (userProfile.nationality2_country_id !== null && EU_PASSPORT_CODES.has(codeForId.get(userProfile.nationality2_country_id)))

        const club = clubRes.data as any
        let currentLeague: string | null = null
        let leagueCountry: string | null = null
        if (club) {
          // Phase 3e — derive league from playing_category. Women + Girls
          // map to women's league family; Men + Boys to men's; Mixed
          // defaults to women's first then men's. Falls back to legacy
          // gender if the category isn't set yet (existing rows that
          // skipped the migration window).
          const cat = userProfile.playing_category as string | null
          const useWomensLeague = cat
            ? (cat === 'adult_women' || cat === 'girls' || cat === 'mixed')
            : userProfile.gender === 'Women'
          currentLeague = useWomensLeague
            ? club.women_league?.name || club.men_league?.name || null
            : club.men_league?.name || club.women_league?.name || null
          leagueCountry = club.country?.name || null
        }

        // Brand product/post counts — only fetched when a brand row exists.
        // Done after the parallel batch so we know the brand id; small extra
        // round-trip but only on brand sessions.
        let brandProductCount = 0
        let brandPostCount = 0
        const brandRow = (brandRes as any)?.data as any
        if (brandRow?.id) {
          const [productsRes, postsRes] = await Promise.all([
            adminClient
              .from('brand_products')
              .select('id', { count: 'exact', head: true })
              .eq('brand_id', brandRow.id)
              .is('deleted_at', null),
            adminClient
              .from('brand_posts')
              .select('id', { count: 'exact', head: true })
              .eq('brand_id', brandRow.id)
              .is('deleted_at', null),
          ])
          brandProductCount = (productsRes as any)?.count || 0
          brandPostCount = (postsRes as any)?.count || 0
        }

        // Compute age from date_of_birth (years only — no exact date sent to LLM)
        let age: number | null = null
        if (userProfile.date_of_birth) {
          const dob = new Date(userProfile.date_of_birth)
          const now = new Date()
          age = now.getFullYear() - dob.getFullYear()
          const m = now.getMonth() - dob.getMonth()
          if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1
        }

        // Truncate bio to a single line, max 200 chars, only if it has real content
        const bioText = (userProfile.bio || '').trim()
        const truncatedBio = bioText.length > 0
          ? (bioText.length > 200 ? bioText.slice(0, 197) + '...' : bioText).replace(/\s+/g, ' ')
          : null

        const hasAvatar = !!userProfile.avatar_url
        const hasBio = !!truncatedBio
        const hasHighlightVideo = !!userProfile.highlight_video_url
        const friendCount = (friendCountRes as any)?.count || 0
        const referenceCount = (referenceCountRes as any)?.count || 0
        const careerCount = (careerCountRes as any)?.count || 0
        const galleryCount = (galleryCountRes as any)?.count || 0

        // Compute role-specific completion + missing-fields list. This is the
        // single source of truth that the LLM uses for "what should I improve"
        // answers (see SYSTEM_PROMPT). Adding a field here surfaces it in
        // the AI's suggestions; keep entries actionable and user-controllable.
        const missingFields: string[] = []
        let totalCriteria = 0
        let metCriteria = 0

        // Universal criteria (every role)
        const universal = [
          { key: 'avatar', met: hasAvatar, label: 'profile photo' },
          { key: 'bio', met: hasBio, label: 'bio' },
          { key: 'base_location', met: !!userProfile.base_city || !!userProfile.base_country_id, label: 'base location' },
          { key: 'onboarding', met: userProfile.onboarding_completed === true, label: 'onboarding (complete sign-up flow)' },
        ]
        for (const c of universal) {
          totalCriteria++
          if (c.met) metCriteria++
          else missingFields.push(c.label)
        }

        // Role-specific criteria
        if (userProfile.role === 'player') {
          const playerCriteria = [
            { met: !!userProfile.position, label: 'primary position' },
            { met: !!userProfile.playing_category, label: 'playing category' },
            { met: !!userProfile.date_of_birth, label: 'date of birth' },
            { met: !!userProfile.nationality_country_id, label: 'nationality' },
            { met: hasHighlightVideo, label: 'highlight video' },
            { met: careerCount > 0, label: 'career history (clubs you\'ve played for)' },
            { met: galleryCount > 0, label: 'gallery photos' },
            { met: referenceCount > 0, label: 'verified references' },
            { met: userProfile.open_to_play || userProfile.open_to_opportunities || false, label: 'availability flag (open to play / opportunities)' },
          ]
          for (const c of playerCriteria) {
            totalCriteria++
            if (c.met) metCriteria++
            else missingFields.push(c.label)
          }
        } else if (userProfile.role === 'coach') {
          const spec = userProfile.coach_specialization_custom || userProfile.coach_specialization
          const coachCriteria = [
            { met: !!spec, label: 'coaching specialization' },
            { met: careerCount > 0, label: 'career history (clubs you\'ve coached at)' },
            { met: referenceCount > 0, label: 'verified references' },
            { met: userProfile.open_to_coach || userProfile.open_to_opportunities || false, label: 'availability flag (open to coach / opportunities)' },
          ]
          for (const c of coachCriteria) {
            totalCriteria++
            if (c.met) metCriteria++
            else missingFields.push(c.label)
          }
        } else if (userProfile.role === 'club') {
          const openVacancyCount = (openVacanciesRes as any)?.count || 0
          const clubCriteria = [
            { met: openVacancyCount > 0, label: 'open opportunities (post a vacancy to attract players/coaches)' },
          ]
          for (const c of clubCriteria) {
            totalCriteria++
            if (c.met) metCriteria++
            else missingFields.push(c.label)
          }
        } else if (userProfile.role === 'brand') {
          const brandCriteria = [
            { met: !!brandRow?.category, label: 'brand category' },
            { met: brandProductCount > 0, label: 'products (add at least one product to the Marketplace)' },
            { met: brandPostCount > 0, label: 'brand posts (share an update)' },
          ]
          for (const c of brandCriteria) {
            totalCriteria++
            if (c.met) metCriteria++
            else missingFields.push(c.label)
          }
        }

        const profileCompletionPct = totalCriteria > 0
          ? Math.round((metCriteria / totalCriteria) * 100)
          : 0

        userContext = {
          role: userProfile.role,
          full_name: userProfile.full_name,
          gender: userProfile.gender,
          // Phase 3e — hockey-category context flows into the LLM prompt.
          playing_category: userProfile.playing_category as string | null,
          coaching_categories: userProfile.coaching_categories as string[] | null,
          umpiring_categories: userProfile.umpiring_categories as string[] | null,
          base_city: userProfile.base_city,
          base_country_name: countryMap.get(userProfile.base_country_id) || null,
          nationality_name: countryMap.get(userProfile.nationality_country_id) || null,
          nationality2_name: countryMap.get(userProfile.nationality2_country_id) || null,
          eu_passport: euPassport,
          position: userProfile.position,
          secondary_position: userProfile.secondary_position,
          age,
          has_highlight_video: hasHighlightVideo,
          coach_specialization: userProfile.coach_specialization,
          coach_specialization_custom: userProfile.coach_specialization_custom,
          current_club: club?.club_name || userProfile.current_club || null,
          current_league: currentLeague,
          league_country: leagueCountry,
          open_to_play: userProfile.open_to_play || false,
          open_to_coach: userProfile.open_to_coach || false,
          open_to_opportunities: userProfile.open_to_opportunities || false,
          bio: truncatedBio,
          onboarding_completed: userProfile.onboarding_completed === true,
          has_avatar: hasAvatar,
          has_bio: hasBio,
          has_career_entry: careerCount > 0,
          has_gallery_photo: galleryCount > 0,
          accepted_friend_count: friendCount,
          accepted_reference_count: referenceCount,
          career_entry_count: careerCount,
          // Club-specific
          open_vacancy_count: userProfile.role === 'club' ? ((openVacanciesRes as any)?.count || 0) : undefined,
          pending_application_count: userProfile.role === 'club' ? ((pendingApplicationsRes as any)?.count || 0) : undefined,
          // Brand-specific
          brand_category: userProfile.role === 'brand' ? (brandRow?.category || null) : undefined,
          brand_product_count: userProfile.role === 'brand' ? brandProductCount : undefined,
          brand_post_count: userProfile.role === 'brand' ? brandPostCount : undefined,
          brand_is_verified: userProfile.role === 'brand' ? !!brandRow?.is_verified : undefined,
          // Computed
          profile_completion_pct: profileCompletionPct,
          missing_fields: missingFields,
        }
      }
    } catch (ctxError) {
      // Non-fatal: AI works generically without user context
      captureException(ctxError, { functionName: 'nl-search', correlationId, note: 'user-context-fetch' })
    }

    pendingUserRole = userContext?.role ?? null

    // ── Phase 0 canned responses ───────────────────────────────────────
    // Opportunities and products are not yet searchable by the AI (Phase 1).
    // Rather than sending the query to the LLM and risking a mixed-profile
    // result, return a clear, role-aware message immediately. This costs
    // ~0 LLM tokens and ~0ms LLM latency.
    if (intent.confidence === 'high' && (intent.entity_type === 'opportunities' || intent.entity_type === 'products')) {
      const oppSuffix = userContext?.role === 'player'
        ? ' — they are filtered for players by default.'
        : userContext?.role === 'coach'
          ? ' — switch the filter to coaching roles in the page header.'
          : '.'
      const productSuffix = userContext?.role === 'brand'
        ? ' — and add your own products from the brand dashboard.'
        : '.'
      const cannedMessage = intent.entity_type === 'opportunities'
        ? `Searching opportunities through Hockia AI is rolling out next. For now you can browse all open opportunities at /opportunities${oppSuffix}`
        : `Browsing products through Hockia AI is rolling out next. For now visit the Marketplace at /marketplace to see what brands have posted${productSuffix}`
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: userContext?.role ?? null,
        query_text: query,
        intent: 'canned_redirect',
        parsed_filters: { _meta: { entity_type: intent.entity_type, confidence: intent.confidence, filter_source: 'keyword', signals: intent.matched_signals } } as any,
        result_count: 0,
        has_qualitative: false,
        llm_provider: llmProvider,
        response_time_ms: Date.now() - startTime,
        error_message: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        cached_tokens: 0,
        prompt_version: PROMPT_VERSION,
        fallback_used: false,
        retry_count: 0,
      }))
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          total: 0,
          has_more: false,
          parsed_filters: null,
          summary: null,
          ai_message: cannedMessage,
          // Phase 1A envelope additions (PR-1, additive only).
          kind: 'canned_redirect' as ResponseKind,
          applied: null,
          suggested_actions: [] as SuggestedAction[],
        }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ── Phase 5 — opportunity-owner recommendations ────────────────────
    // Clubs and coaches asking about their own pipeline get a real
    // recommendation from their applicants, not a generic deflection.
    // Non-owners (or queries with no actual owned opportunities) fall
    // through to normal search.
    if (intent.confidence === 'high' && intent.entity_type === 'own_applicants') {
      const ownerRole = userContext?.role
      if (ownerRole === 'club' || ownerRole === 'coach') {
        return handleOwnApplicantsIntent({
          adminClient,
          userId: user.id,
          query,
          userContext,
          llmProvider,
          startTime,
          correlationId,
          headers,
        })
      }
      // else: fall through to normal LLM search.
    }

    // ── Platform help ("how do I use HOCKIA?") ─────────────────────────
    // Feature / how-to questions route here via the platform_help intent.
    // We answer with a short role-aware explanation + one CTA, instead of
    // sending the query down the profile-search path (which would either
    // return mixed profiles or a canned redirect). Needs userContext for
    // role-awareness; without it we fall through to the normal LLM flow.
    if (intent.entity_type === 'platform_help' && userContext) {
      try {
        const { result: helpResult, meta: helpMeta } = await answerPlatformHelp({
          userQuery: query,
          userContext,
        })
        const cta = resolveFeatureCta(helpResult.feature_key, userContext.role)
        fireAndForget(logDiscoveryEvent(adminClient, {
          user_id: user.id,
          role: userContext.role,
          query_text: query,
          intent: 'platform_help',
          parsed_filters: { _meta: {
            entity_type: 'platform_help',
            confidence: intent.confidence,
            filter_source: 'keyword',
            signals: intent.matched_signals,
            feature_key: helpResult.feature_key,
            has_cta: !!cta,
            kind: 'canned_redirect',
          } } as any,
          result_count: 0,
          has_qualitative: false,
          llm_provider: llmProvider,
          response_time_ms: Date.now() - startTime,
          error_message: null,
          prompt_tokens: helpMeta.usage?.prompt_tokens ?? null,
          completion_tokens: helpMeta.usage?.completion_tokens ?? null,
          cached_tokens: helpMeta.usage?.cached_tokens ?? null,
          prompt_version: PROMPT_VERSION,
          fallback_used: false,
          retry_count: helpMeta.retry_count,
        }))
        return new Response(
          JSON.stringify({
            success: true,
            data: [],
            total: 0,
            has_more: false,
            parsed_filters: null,
            summary: null,
            ai_message: helpResult.answer,
            // Reuses the canned_redirect kind — CannedRedirectCard renders
            // the message + the explicit `cta` button.
            kind: 'canned_redirect' as ResponseKind,
            applied: null,
            suggested_actions: [] as SuggestedAction[],
            cta,
          }),
          { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      } catch (err) {
        // LLM failure on the help path — don't hard-fail; fall through to
        // the normal flow so the user still gets an answer.
        captureException(err, {
          functionName: 'nl-search',
          correlationId,
          extra: { phase: 'platform_help' },
        })
      }
    }

    // ── LLM parsing ─────────────────────────────────────────────────────
    // Pass the intent hint so the LLM knows what entity type the user is
    // asking for. The hint is informational; the backend ENFORCES below
    // for HIGH-confidence intents regardless of the LLM's output.
    const { result: parseResult, meta: parseMeta } = await parseSearchQuery(query, history, userContext, intent)

    // ── Phase 0 forced-search override ──────────────────────────────────
    // When the keyword router is HIGH confidence on a profile-entity type
    // AND the user used a search-imperative verb (find/show/look-for/etc.)
    // BUT the LLM still chose `respond`/`knowledge` instead of search_profiles,
    // the backend overrides and runs the search anyway. The LLM is not
    // allowed to opt out of searching when the user clearly asked for a
    // search.
    //
    // Safeguard: we require a search-imperative verb so that knowledge-style
    // queries like "tell me about defenders" don't accidentally get forced
    // into a profile search. Self-reflection / hockey-knowledge / greeting
    // intents are excluded by entity type.
    const PROFILE_ENTITIES = new Set(['clubs', 'players', 'coaches', 'brands', 'umpires'])
    const HAS_SEARCH_IMPERATIVE = /\b(find|show|look(ing)? for|recommend|search( for)?|browse|list|get me)\b/i.test(query)
    const llmSelectedTool: 'search' | 'conversation' | 'knowledge' | 'world_club_search' = parseResult.type
    let backendForcedSearch = false
    let forcedReason: string | null = null

    let llmResult = parseResult
    if (
      (parseResult.type === 'conversation' || parseResult.type === 'knowledge') &&
      intent.confidence === 'high' &&
      PROFILE_ENTITIES.has(intent.entity_type) &&
      HAS_SEARCH_IMPERATIVE
    ) {
      // Synthesize a search intent so the existing search path runs. The
      // LLM didn't extract any filters (it chose respond) so we hand off
      // to the backend's role enforcement + UserContext seeding for the
      // actual filtering. result_count + count phrase do the rest.
      llmResult = {
        type: 'search',
        filters: {} as ParsedFilters,
        message: '',
        include_qualitative: false,
      }
      backendForcedSearch = true
      forcedReason = `router=${intent.entity_type}/high + imperative present, but LLM chose ${parseResult.type}`
    }

    // ── Conversation or knowledge response (no search needed) ────────
    if (llmResult.type === 'conversation' || llmResult.type === 'knowledge') {
      // Phase 1A: emit role-aware action chips for self-advice and greetings.
      // Knowledge answers and other generic responses ship with no chips
      // (no clear next-action). Adding chips later is an opt-in change.
      let convoActions: SuggestedAction[] = []
      if (intent.entity_type === 'self_advice') {
        convoActions = getSelfAdviceActions(userContext?.role ?? null)
      } else if (intent.entity_type === 'greeting') {
        // Phase 4 audit P3-2: role-aware greeting chips so first contact has
        // a real menu, not just a single capability chip.
        convoActions = getGreetingActions(userContext?.role ?? null)
      }

      const convoMeta = {
        _meta: {
          router_entity_type: intent.entity_type,
          router_confidence: intent.confidence,
          router_signals: intent.matched_signals,
          llm_selected_tool: llmSelectedTool,
          backend_forced_search: false,
          // Phase 1A telemetry additions
          kind: 'text' as ResponseKind,
          suggested_actions_count: convoActions.length,
        },
      }
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: userContext?.role ?? null,
        query_text: query,
        intent: llmResult.type,
        parsed_filters: convoMeta as any,
        result_count: 0,
        has_qualitative: false,
        llm_provider: llmProvider,
        response_time_ms: Date.now() - startTime,
        error_message: null,
        prompt_tokens: parseMeta.usage?.prompt_tokens ?? null,
        completion_tokens: parseMeta.usage?.completion_tokens ?? null,
        cached_tokens: parseMeta.usage?.cached_tokens ?? null,
        prompt_version: PROMPT_VERSION,
        fallback_used: false,
        retry_count: parseMeta.retry_count,
      }))
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          total: 0,
          has_more: false,
          parsed_filters: null,
          summary: null,
          ai_message: llmResult.message,
          // Phase 1A envelope additions (PR-1, additive only).
          kind: 'text' as ResponseKind,
          applied: null,
          suggested_actions: convoActions,
        }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ── Phase 4 MVP-B: World directory club search ──────────────────
    // The new search_world_clubs_directory tool routes here. We query
    // public.world_clubs directly (no RPC needed — the table is small
    // and the filters map cleanly to JS-builder calls). Results merge
    // into `data[]` with result_type='world_club' so the frontend can
    // render claimed and unclaimed clubs side-by-side.
    if (llmResult.type === 'world_club_search') {
      const wcFilters = llmResult.filters

      // Resolve country names → IDs (same shape as the regular search path).
      let wcCountryIds: number[] | null = null
      if (wcFilters.country_names?.length) {
        const orConditions = wcFilters.country_names.map(n =>
          `name.ilike.%${n}%,common_name.ilike.%${n}%,nationality_name.ilike.%${n}%`
        ).join(',')
        const { data } = await adminClient.from('countries').select('id').or(orConditions)
        if (data?.length) wcCountryIds = data.map((c: any) => c.id)
      }

      // Resolve province names → IDs (optional).
      let wcProvinceIds: number[] | null = null
      if (wcFilters.province_names?.length) {
        const orConditions = wcFilters.province_names.map(p => `name.ilike.%${p}%`).join(',')
        const { data } = await adminClient.from('world_provinces').select('id').or(orConditions)
        if (data?.length) wcProvinceIds = data.map((p: any) => p.id)
      }

      // Resolve league names → IDs (optional). World_clubs has separate
      // men's and women's league columns; we match either.
      let wcLeagueIds: number[] | null = null
      if (wcFilters.league_names?.length) {
        const orConditions = wcFilters.league_names.map(l => `name.ilike.%${l}%`).join(',')
        const { data } = await adminClient.from('world_leagues').select('id').or(orConditions)
        if (data?.length) wcLeagueIds = data.map((l: any) => l.id)
      }

      // Build the query. Order: claimed first (clubs you can message inside
      // HOCKIA are most actionable), then alphabetic. Cap at 20 results so
      // the UI doesn't drown the user.
      let wcQuery = adminClient
        .from('world_clubs')
        .select(`
          id, club_name, avatar_url, is_claimed, claimed_profile_id,
          country:countries!world_clubs_country_id_fkey(id, name, code, flag_emoji),
          province:world_provinces!world_clubs_province_id_fkey(id, name, slug),
          men_league:world_leagues!world_clubs_men_league_id_fkey(id, name, tier),
          women_league:world_leagues!world_clubs_women_league_id_fkey(id, name, tier)
        `)
        .order('is_claimed', { ascending: false })
        .order('club_name', { ascending: true })
        // Respect an explicit count ("find me 5 clubs") — fall back to a
        // larger directory window when none is named, so the UI can still
        // show 3 + "Show all N".
        .limit(tryExtractCount(query) ?? 20)

      if (wcCountryIds) wcQuery = wcQuery.in('country_id', wcCountryIds)
      if (wcProvinceIds) wcQuery = wcQuery.in('province_id', wcProvinceIds)
      if (wcLeagueIds && wcLeagueIds.length > 0) {
        // Either league column is in the filter set.
        wcQuery = wcQuery.or(
          `men_league_id.in.(${wcLeagueIds.join(',')}),women_league_id.in.(${wcLeagueIds.join(',')})`
        )
      }
      if (wcFilters.text_query?.trim()) {
        wcQuery = wcQuery.ilike('club_name_normalized', `%${wcFilters.text_query.toLowerCase().trim()}%`)
      }
      if (wcFilters.claimed_only === true) {
        wcQuery = wcQuery.eq('is_claimed', true)
      }
      // Production audit fix — a club searching "clubs in Argentina" shouldn't
      // see itself in its own results. The world_club row that claims this
      // user's profile is excluded for club-role searchers.
      if (userContext?.role === 'club') {
        wcQuery = wcQuery.or(`claimed_profile_id.is.null,claimed_profile_id.neq.${user.id}`)
      }

      const { data: wcRows, error: wcErr } = await wcQuery
      if (wcErr) {
        captureException(wcErr, { functionName: 'nl-search', correlationId, extra: { phase: 'world_club_search' } })
      }

      // Map to a unified DiscoverResult-shaped row. The frontend switches
      // on result_type to render the world-club variant (no avatar pills,
      // claimed/unclaimed badge, navigates to /world/... or /clubs/id/...).
      const mapped = ((wcRows || []) as any[]).map((wc: any) => ({
        id: wc.id,
        full_name: wc.club_name ?? null,
        username: null,
        avatar_url: wc.avatar_url ?? null,
        role: 'club',
        position: null,
        secondary_position: null,
        gender: null,
        playing_category: null,
        coaching_categories: null,
        umpiring_categories: null,
        age: null,
        nationality_country_id: wc.country?.id ?? null,
        nationality2_country_id: null,
        nationality_name: wc.country?.name ?? null,
        nationality2_name: null,
        flag_emoji: wc.country?.flag_emoji ?? null,
        flag_emoji2: null,
        base_location: wc.province?.name ?? null,
        base_country_name: wc.country?.name ?? null,
        current_club: null,
        current_world_club_id: wc.id,
        open_to_play: false,
        open_to_coach: false,
        open_to_opportunities: false,
        accepted_reference_count: 0,
        career_entry_count: 0,
        accepted_friend_count: 0,
        last_active_at: null,
        coach_specialization: null,
        coach_specialization_custom: null,
        // Phase 4 MVP-B fields
        result_type: 'world_club' as const,
        claimed: !!wc.is_claimed,
        claimed_profile_id: wc.claimed_profile_id ?? null,
        league_name: wc.women_league?.name || wc.men_league?.name || null,
        province_name: wc.province?.name || null,
        country_code: wc.country?.code ?? null,
      }))

      const claimedCount = mapped.filter((r: any) => r.claimed).length
      const unclaimedCount = mapped.length - claimedCount
      const locationLabel = wcFilters.country_names?.[0] || null

      // Compose ai_message. With results, give a quick count summary that
      // names the claimed/unclaimed split — it's the most actionable insight
      // for the user. With 0, run composeNoResults for proactive diagnosis.
      let wcAiMessage: string
      let wcNoResultsFollowUp: string | null = null
      let wcNoResultsMeta: LLMCallMeta | null = null
      if (mapped.length > 0) {
        const total = mapped.length
        const noun = total === 1 ? 'club' : 'clubs'
        const where = locationLabel ? ` in ${locationLabel}` : wcFilters.text_query ? ` matching "${wcFilters.text_query}"` : ''
        const isAre = (n: number) => (n === 1 ? 'is' : 'are')
        // The UI shows the top 3 first (claimed clubs lead) with a "Show
        // all" expander. Naming that turns the response into a curated
        // recommendation rather than a directory dump the user must sift.
        const topNote = total > 3 ? ' Here are the top 3 to start with.' : ''
        if (claimedCount > 0 && unclaimedCount > 0) {
          wcAiMessage = `I found ${total} ${noun}${where}. ${claimedCount} ${isAre(claimedCount)} active on HOCKIA, so you can message them directly, and ${unclaimedCount} ${isAre(unclaimedCount)} in the directory but not yet claimed, so you may need to reach out externally.${topNote}`
        } else if (claimedCount > 0) {
          wcAiMessage = `I found ${total} ${noun}${where} — all active on HOCKIA, so you can message them directly.${topNote}`
        } else {
          wcAiMessage = `I found ${total} ${noun}${where} in HOCKIA's directory. None are claimed yet, so you'll need to reach out externally — but they're real clubs worth exploring.${topNote}`
        }
        // Phase 4 audit P1-1 — DO NOT append llmResult.message here. The LLM
        // generates that field at parse-time before knowing the count, so it
        // tends to read as future-tense ("Let me find clubs in Spain for
        // you!") even though results are already presented above. The
        // deterministic count phrase is enough; future-tense kicker breaks
        // the "results are in" feel of the response.
      } else if (userContext) {
        // 0 results — compose a richer diagnosis just like the regular path.
        try {
          const syntheticFilters: ParsedFilters = {
            roles: ['club'],
            countries: wcFilters.country_names,
            text_query: wcFilters.text_query,
          }
          const { result: nrResult, meta: nrMeta } = await composeNoResults({
            userQuery: query,
            searchCriteria: syntheticFilters,
            effectiveCategory: null,
            categorySource: 'none',
            entityNoun: 'clubs',
            userContext,
          })
          wcNoResultsMeta = nrMeta
          wcAiMessage = nrResult.ai_message?.trim() || `I couldn't find any clubs matching that in HOCKIA's directory.`
          if (nrResult.follow_up_query?.trim()) wcNoResultsFollowUp = nrResult.follow_up_query.trim()
        } catch (nrErr) {
          captureException(nrErr, { functionName: 'nl-search', correlationId, extra: { phase: 'compose_no_results_world_club' } })
          wcAiMessage = `I couldn't find any clubs matching that in HOCKIA's directory${locationLabel ? ` for ${locationLabel}` : ''}.`
        }
      } else {
        wcAiMessage = `I couldn't find any clubs matching that in HOCKIA's directory${locationLabel ? ` for ${locationLabel}` : ''}.`
      }

      const wcApplied: AppliedSearch = {
        entity: 'clubs',
        category_label: null,
        gender_label: null,
        location_label: locationLabel,
        role_summary: locationLabel ? `clubs in ${locationLabel}` : 'clubs',
      }
      const wcResponseKind: ResponseKind = mapped.length === 0 ? 'no_results' : 'results'
      let wcSuggestedActions: SuggestedAction[] = wcResponseKind === 'no_results'
        ? getNoResultsActions(wcApplied, userContext?.role ?? null)
        : []
      if (wcNoResultsFollowUp) {
        const fLabel = wcNoResultsFollowUp.length > 38
          ? wcNoResultsFollowUp.slice(0, 35).trim() + '…'
          : wcNoResultsFollowUp
        const wcFollowUpAction: SuggestedAction = {
          label: fLabel,
          intent: { type: 'free_text', query: wcNoResultsFollowUp },
        }
        wcSuggestedActions = [wcFollowUpAction, ...wcSuggestedActions].slice(0, 4)
      }

      // Telemetry — distinguishable from the regular search path via
      // llm_selected_tool=search_world_clubs_directory.
      const wcParsedWithMeta = {
        ...wcFilters,
        _meta: {
          router_entity_type: intent.entity_type,
          router_confidence: intent.confidence,
          router_signals: intent.matched_signals,
          llm_selected_tool: 'world_club_search',
          backend_forced_search: false,
          kind: wcResponseKind,
          applied_role_summary: wcApplied.role_summary,
          suggested_actions_count: wcSuggestedActions.length,
          world_club_search: true,
          world_club_total: mapped.length,
          world_club_claimed: claimedCount,
          world_club_unclaimed: unclaimedCount,
        },
      }
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: userContext?.role ?? null,
        query_text: query,
        intent: 'search',
        parsed_filters: wcParsedWithMeta as any,
        result_count: mapped.length,
        has_qualitative: false,
        llm_provider: llmProvider,
        response_time_ms: Date.now() - startTime,
        error_message: null,
        prompt_tokens: sumNullable(parseMeta.usage?.prompt_tokens ?? null, wcNoResultsMeta?.usage?.prompt_tokens ?? null),
        completion_tokens: sumNullable(parseMeta.usage?.completion_tokens ?? null, wcNoResultsMeta?.usage?.completion_tokens ?? null),
        cached_tokens: sumNullable(parseMeta.usage?.cached_tokens ?? null, wcNoResultsMeta?.usage?.cached_tokens ?? null),
        prompt_version: PROMPT_VERSION,
        fallback_used: false,
        retry_count: parseMeta.retry_count + (wcNoResultsMeta?.retry_count ?? 0),
      }))

      return new Response(
        JSON.stringify({
          success: true,
          data: mapped,
          total: mapped.length,
          has_more: false,
          parsed_filters: wcFilters,
          summary: wcFilters.summary || `${mapped.length} club result${mapped.length === 1 ? '' : 's'}.`,
          ai_message: wcAiMessage,
          kind: wcResponseKind,
          applied: wcApplied,
          suggested_actions: wcSuggestedActions,
        }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ── Search intent: resolve filters + call RPC ────────────────────
    const parsed: ParsedFilters = llmResult.filters
    let synthMeta: LLMCallMeta | null = null

    // ── Resolve text values → IDs ───────────────────────────────────────
    let nationalityCountryIds: number[] | null = null
    let baseCountryIds: number[] | null = null
    let baseLocationText: string | null = null
    let leagueIds: number[] | null = null
    let countryIds: number[] | null = null

    // Resolve nationality names → country IDs
    if (parsed.nationalities?.length) {
      const orConditions = parsed.nationalities.map(n =>
        `name.ilike.%${n}%,common_name.ilike.%${n}%,nationality_name.ilike.%${n}%`
      ).join(',')
      const { data } = await adminClient.from('countries').select('id').or(orConditions)
      if (data?.length) nationalityCountryIds = data.map(c => c.id)
    }

    // Resolve location names → country IDs + text for city ILIKE
    if (parsed.locations?.length) {
      const orConditions = parsed.locations.map(l =>
        `name.ilike.%${l}%,common_name.ilike.%${l}%,code.ilike.${l}`
      ).join(',')
      const { data } = await adminClient.from('countries').select('id').or(orConditions)
      if (data?.length) baseCountryIds = data.map(c => c.id)
      // Also pass first location as text for city-level ILIKE
      baseLocationText = parsed.locations[0]
    }

    // Resolve league names → IDs
    if (parsed.leagues?.length) {
      const orConditions = parsed.leagues.map(l => `name.ilike.%${l}%`).join(',')
      const { data } = await adminClient.from('world_leagues').select('id').or(orConditions)
      if (data?.length) leagueIds = data.map(l => l.id)
    }

    // Resolve "countries" (playing-in context) → IDs
    if (parsed.countries?.length) {
      const orConditions = parsed.countries.map(c =>
        `name.ilike.%${c}%,common_name.ilike.%${c}%`
      ).join(',')
      const { data } = await adminClient.from('countries').select('id').or(orConditions)
      if (data?.length) countryIds = data.map(c => c.id)
    }

    // ── Phase 0 server-side role enforcement ────────────────────────────
    // For HIGH-confidence keyword-router intents, IGNORE the LLM's role
    // extraction and force the role we detected. This is the fix for the
    // "asked for clubs, got mixed players/coaches/clubs/brands" bug — the
    // LLM was dropping `roles` ~50% of the time on clear queries, then we
    // were falling back to all 4 discoverable roles. Now the keyword
    // router is the source of truth when confidence is high.
    let effectiveRoles: string[]
    let filterSource: 'keyword' | 'llm' | 'fallback' | 'none' = 'none'
    const enforcedRole = intent.confidence === 'high' ? entityTypeToRole(intent.entity_type) : null
    if (enforcedRole) {
      effectiveRoles = [enforcedRole]
      filterSource = 'keyword'
    } else if (parsed.roles && parsed.roles.length > 0) {
      effectiveRoles = parsed.roles
      filterSource = 'llm'
    } else {
      // No clear keyword AND no LLM filter — historically we fell back to
      // ['player','coach','club','brand'] which is exactly the mixed-result
      // bug. Phase 0 keeps the fallback for now but tags it so we can spot
      // it in telemetry. Phase 1 will replace this with a clarifying-question
      // path: "Are you looking for clubs, players, coaches, or opportunities?"
      effectiveRoles = ['player', 'coach', 'club', 'brand']
      filterSource = 'fallback'
    }

    // ── Phase 3e: UserContext-seeded category (clubs only) ────────────
    // Replaces the Phase 0 gender-seeding block. When a player or coach
    // asks "find clubs for me" without specifying a category, seed it from
    // their profile so the search isn't generic. Only applies to club
    // searches; player/coach/brand searches would over-restrict.
    //
    // The LLM emits `target_category`; we accept legacy `gender` from any
    // stale clients and translate at the boundary.
    const llmCategory: string | null = (parsed.target_category as string | undefined) || null
    let effectiveCategory: string | null = llmCategory
    let categorySource: 'llm' | 'context' | 'none' = llmCategory ? 'llm' : 'none'

    // Legacy gender fallback. If the LLM still emitted `gender` (rare with
    // the new prompt but possible during the deploy window), translate it.
    let effectiveGender = parsed.gender || null
    if (!effectiveCategory && parsed.gender) {
      if (parsed.gender === 'Men') effectiveCategory = 'adult_men'
      else if (parsed.gender === 'Women') effectiveCategory = 'adult_women'
      if (effectiveCategory) categorySource = 'llm'
    }

    // Phase 1A — when the query is a "broaden" follow-up (chip-driven),
    // skip the UserContext seeding entirely. Updated regex to match the
    // new chip wording ("Remove [Adult Women] filter", "Show all categories")
    // plus the legacy gender phrasings still in flight.
    // Phase 4 chip-label fix — extended to match the short "Remove X filter"
    // chip queries that ship from the no-results catalog when label === query
    // (e.g. "Remove Adult Women filter", "Remove Girls filter"). Without
    // matching these, the auto-seed re-applies on the broaden tap and the
    // chip silently does nothing.
    const QUERY_FORBIDS_CATEGORY_SEED =
      /\b(any (gender|category)|all (genders?|categories?)|without (a |any )?(gender|category)( filter)?|regardless of (gender|category)|gender[- ]neutral|both genders|men[''']?s and women[''']?s|men and women|show all (clubs|players|coaches|umpires|categories)|remove (the )?(adult women|adult men|girls|boys|mixed|category|gender) filter)\b/i.test(query)

    if (
      !effectiveCategory &&
      !QUERY_FORBIDS_CATEGORY_SEED &&
      enforcedRole === 'club' &&
      (userContext?.role === 'player' || userContext?.role === 'coach')
    ) {
      // Player: seed from playing_category if present.
      if (userContext?.role === 'player' && userContext.playing_category) {
        effectiveCategory = userContext.playing_category
        categorySource = 'context'
      }
      // Coach: seed from coaching_categories ONLY if they have a single
      // concrete value. Multi-category coaches and 'any' coaches don't
      // auto-seed — over-filtering would hurt them more than helping.
      if (userContext?.role === 'coach' && userContext.coaching_categories) {
        const cats = userContext.coaching_categories
        if (cats.length === 1 && cats[0] !== 'any') {
          effectiveCategory = cats[0]
          categorySource = 'context'
        }
      }
    }

    // Phase 3e: also derive a legacy gender label for the dual-write era —
    // helps any older client still reading `gender_label` on the response.
    if (!effectiveGender && effectiveCategory) {
      if (effectiveCategory === 'adult_men') effectiveGender = 'Men'
      else if (effectiveCategory === 'adult_women') effectiveGender = 'Women'
    }

    // Phase 1c — compound multi-role search. When the query names explicit
    // counts for 2+ different roles ("2 players and 1 coach"), a single
    // discover_profiles call can't express per-role counts — so run one
    // sub-search per role and merge, in the order asked. Load-more requests
    // (offset > 0) never go compound; "Show more" stays single-role.
    const roleCounts = requestedOffset > 0 ? [] : extractRoleCounts(query)
    const isCompound = roleCounts.length >= 2

    const baseDiscoverParams = {
      p_positions: parsed.positions || null,
      // Phase 3e: prefer the new category param. Legacy p_gender is also
      // passed for one cycle in case the RPC migration is rolled back.
      p_target_category: effectiveCategory,
      p_gender: effectiveGender,
      p_min_age: parsed.min_age || null,
      p_max_age: parsed.max_age || null,
      p_nationality_country_ids: nationalityCountryIds,
      p_eu_passport: parsed.eu_passport || null,
      p_base_country_ids: baseCountryIds,
      p_base_location: baseLocationText,
      p_availability: parsed.availability || null,
      p_min_references: parsed.min_references || null,
      p_min_career_entries: parsed.min_career_entries || null,
      p_league_ids: leagueIds,
      p_country_ids: countryIds,
      p_search_text: parsed.text_query || null,
      p_coach_specializations: parsed.coach_specializations || null,
      p_sort_by: parsed.sort_by || 'relevance',
    }

    let rpcResult: { results: any[]; total: number; has_more: boolean } | null = null
    let rpcError: { message?: string } | null = null

    if (isCompound) {
      const merged: any[] = []
      for (const rc of roleCounts) {
        // A sub-search must not inherit filters that don't fit its role.
        // A player-only filter (an "open to play" availability, a playing
        // position, a league) zeroes out every coach; a coach-only filter
        // (coach specialization) zeroes out every player. And a category
        // seeded from the *searcher's own profile* (categorySource ===
        // 'context') shouldn't silently narrow a multi-role search they
        // never explicitly scoped. Apply each filter only where it belongs.
        const avail = baseDiscoverParams.p_availability
        const { data, error } = await adminClient.rpc('discover_profiles', {
          ...baseDiscoverParams,
          p_roles: [rc.role],
          // Position-aware compound: a sub-search with a specific position
          // ("1 goalkeeper") narrows to that position; otherwise the player
          // sub-search inherits any LLM-parsed positions from the query.
          p_positions: rc.position
            ? [rc.position]
            : (rc.role === 'player' ? baseDiscoverParams.p_positions : null),
          p_coach_specializations: rc.role === 'coach' ? baseDiscoverParams.p_coach_specializations : null,
          p_league_ids: rc.role === 'player' || rc.role === 'club' ? baseDiscoverParams.p_league_ids : null,
          p_availability:
            avail === 'open_to_play' ? (rc.role === 'player' ? avail : null)
              : avail === 'open_to_coach' ? (rc.role === 'coach' ? avail : null)
                : avail,
          p_target_category: categorySource === 'context' ? null : baseDiscoverParams.p_target_category,
          p_gender: categorySource === 'context' ? null : baseDiscoverParams.p_gender,
          p_limit: rc.count,
          p_offset: 0,
        })
        if (error) { rpcError = error; break }
        const rows = (data as { results: any[] } | null)?.results ?? []
        merged.push(...rows)
      }
      // total/has_more reflect what was actually assembled — each role got
      // its own requested count, so there is no single list to "show more".
      if (!rpcError) rpcResult = { results: merged, total: merged.length, has_more: false }
    } else {
      const { data, error } = await adminClient.rpc('discover_profiles', {
        ...baseDiscoverParams,
        p_roles: effectiveRoles,
        // Phase 1b — the explicit count governs the first page; "Show more"
        // load-more requests (offset > 0) page in default-sized batches.
        p_limit: requestedOffset > 0 ? DEFAULT_RESULT_LIMIT : resolveResultLimit(query),
        p_offset: requestedOffset,
      })
      rpcResult = data
      rpcError = error
    }

    if (rpcError) {
      captureException(rpcError, { functionName: 'nl-search', correlationId })
      // PR-3/PR-4: return 200 with kind=soft_error so the frontend renders
      // a calm <SoftErrorCard />. PR-4 adds variation: if the previous turn
      // was already a soft_error, the user gets a different message + chip
      // set so we don't show the same "I had trouble" copy twice.
      const isRepeatSoftError = recoveryContext?.last_kind === 'soft_error'
      const softErrorActions = isRepeatSoftError ? getRepeatedSoftErrorActions() : getSoftErrorActions()
      const softErrorMessage = isRepeatSoftError
        ? "That still didn't go through. Let's try a simpler path."
        : "I had trouble completing that search. Want to try again or broaden it?"
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: userContext?.role ?? null,
        query_text: query,
        intent: 'error',
        parsed_filters: { _meta: { kind: 'soft_error', error_phase: 'rpc', repeated: isRepeatSoftError, suggested_actions_count: softErrorActions.length } } as any,
        result_count: 0,
        has_qualitative: false,
        llm_provider: llmProvider,
        response_time_ms: Date.now() - startTime,
        error_message: (rpcError as { message?: string })?.message ?? 'discover_profiles RPC failed',
        prompt_tokens: parseMeta.usage?.prompt_tokens ?? null,
        completion_tokens: parseMeta.usage?.completion_tokens ?? null,
        cached_tokens: parseMeta.usage?.cached_tokens ?? null,
        prompt_version: PROMPT_VERSION,
        fallback_used: false,
        retry_count: parseMeta.retry_count,
      }))
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          total: 0,
          has_more: false,
          parsed_filters: null,
          summary: null,
          ai_message: softErrorMessage,
          kind: 'soft_error' as ResponseKind,
          applied: null,
          suggested_actions: softErrorActions,
        }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const result = rpcResult as { results: any[]; total: number; has_more: boolean }

    // Phase 4 — drop profiles the user has already seen in this chat. The
    // count message below uses result.results.length (post-filter), so the
    // headline stays honest. result.total stays as the DB-level match
    // count — has_more semantics are kept conservative.
    if (excludedIds.length > 0) {
      const excludedSet = new Set(excludedIds)
      result.results = result.results.filter((r: any) => !excludedSet.has(r?.id))
    }

    // Production audit B5 — two profiles with the same name + nationality
    // are almost always duplicate accounts of the same person (the platform
    // has a few in the wild). Keep one per (name + nationality), preferring
    // the richer profile by completeness. Defensive about missing fields:
    // rows without a usable name+nationality signature are kept as-is.
    {
      const seenIdentity = new Map<string, { idx: number; pct: number }>()
      const deduped: any[] = []
      for (const r of result.results as any[]) {
        const name = (r?.full_name ?? '').toString().toLowerCase().trim()
        const nat = r?.nationality_country_id
        if (!name || nat == null) { deduped.push(r); continue }
        const key = `${name}|${nat}`
        const pct = r?.profile_completeness_pct ?? 0
        const existing = seenIdentity.get(key)
        if (!existing) {
          seenIdentity.set(key, { idx: deduped.length, pct })
          deduped.push(r)
        } else if (pct > existing.pct) {
          deduped[existing.idx] = r
          seenIdentity.set(key, { idx: existing.idx, pct })
        }
      }
      result.results = deduped
    }

    // ── Result-aware AI message ──────────────────────────────────────
    // When the keyword router enforced a specific entity type, phrase the
    // empty/match copy in those terms ("no clubs found") rather than the
    // generic "no profiles found", and suggest broadening only when it
    // makes sense (e.g. drop the gender filter we auto-seeded).
    const entityNoun = enforcedRole === 'club' ? 'clubs'
      : enforcedRole === 'player' ? 'players'
      : enforcedRole === 'coach' ? 'coaches'
      : enforcedRole === 'brand' ? 'brands'
      : enforcedRole === 'umpire' ? 'umpires'
      : 'profiles'
    // Phase 3e — proper singular forms. The previous slice(-1) trick produced
    // "1 coache" because "coaches" → "coache" instead of "coach". Map-based
    // singularisation handles the -es words correctly.
    const ENTITY_SINGULAR: Record<string, string> = {
      clubs: 'club',
      players: 'player',
      coaches: 'coach',
      brands: 'brand',
      umpires: 'umpire',
      profiles: 'profile',
    }
    let aiMessage: string
    let noResultsFollowUpQuery: string | null = null
    let noResultsMeta: LLMCallMeta | null = null
    if (result.total === 0) {
      // Phase 3e — broaden hint references the auto-seeded category, not gender.
      const broadenHint = categorySource === 'context' && effectiveCategory
        ? ` I filtered by your category (${effectiveCategory.replace('_', ' ')}) — want me to broaden that?`
        : ''
      aiMessage = `I couldn't find any ${entityNoun} matching that.${broadenHint}`
    } else {
      // Count the rows the user can actually see, not result.total (the
      // full match count). On a "Show more" load-more request the count is
      // cumulative — requestedOffset already-shown + this page — so the
      // headline message keeps pace with the growing list.
      const shown = requestedOffset + result.results.length
      const noun = shown === 1 ? (ENTITY_SINGULAR[entityNoun] ?? entityNoun) : entityNoun
      // Headline is the deterministic count phrase only. We *don't* append
      // llmResult.message here — the LLM phrases its own count at parse
      // time, before knowing what was returned, so the two can disagree
      // (audit found "I found 7" + "5 players found across..." stacked).
      //
      // Phase 6 (B11) — geographic narration. When the search constrained
      // by base-location (city or country), name it in the headline so the
      // owner sees what scope they're inside and can broaden if needed.
      // The chip strip already lists this filter; the headline mirror is
      // the one that gets read first.
      // geoLabel originates from the LLM parse of a user query; sanitize
      // before embedding into the chat bubble. The bubble renders as plain
      // text (no innerHTML) so HTML is already safe, but newlines and
      // chat-confusing characters (•, ─, etc.) would still render literally.
      // Restrict to letters / digits / spaces / common name punctuation
      // (- . , ' ()) and cap at 40 chars.
      const rawGeo = baseLocationText ?? (parsed.locations?.[0] ?? null)
      const geoLabel = rawGeo
        ? rawGeo.replace(/[^\p{L}\p{N}\s\-.,'()]/gu, '').trim().slice(0, 40) || null
        : null
      aiMessage = geoLabel
        ? `I found ${shown} ${noun} based in ${geoLabel} — say "broaden the location" to widen this.`
        : `I found ${shown} ${noun} for you.`
    }

    // ── Phase 4 — proactive no-results diagnosis ─────────────────────
    // When a profile search returns 0 AND we have UserContext, run a
    // dedicated LLM pass that combines what was searched + why 0 likely
    // happened + concrete profile-gap diagnosis + acknowledgment of
    // strengths + one concrete follow-up offer. Replaces the templated
    // "I couldn't find any clubs matching that" with something
    // substantive. Failure is non-fatal — we keep the templated message.
    if (result.total === 0 && userContext) {
      try {
        const { result: noResultsResult, meta: nrMeta } = await composeNoResults({
          userQuery: query,
          searchCriteria: parsed,
          effectiveCategory,
          categorySource,
          entityNoun,
          userContext,
        })
        noResultsMeta = nrMeta
        if (noResultsResult.ai_message?.trim()) {
          aiMessage = noResultsResult.ai_message.trim()
        }
        if (noResultsResult.follow_up_query?.trim()) {
          noResultsFollowUpQuery = noResultsResult.follow_up_query.trim()
        }
      } catch (nrError) {
        // Compose pass is non-fatal — fall back to the templated message.
        captureException(nrError, { functionName: 'nl-search', correlationId, extra: { phase: 'compose_no_results' } })
      }
    }

    // ── Qualitative enrichment (opt-in, triggered by LLM) ───────────
    if (llmResult.include_qualitative && result.results.length > 0) {
      try {
        const topIds = result.results.slice(0, 5).map((r: any) => r.id).filter(Boolean)

        if (topIds.length > 0) {
          const [commentsRes, refsRes] = await Promise.all([
            adminClient
              .from('profile_comments')
              .select('profile_id, content, rating, author:profiles!profile_comments_author_profile_id_fkey(full_name, role)')
              .in('profile_id', topIds)
              .eq('status', 'visible')
              .order('created_at', { ascending: false })
              .limit(50),
            adminClient
              .from('profile_references')
              .select('requester_id, endorsement_text, relationship_type, endorser:profiles!profile_references_reference_id_fkey(full_name, role)')
              .in('requester_id', topIds)
              .eq('status', 'accepted')
              .order('accepted_at', { ascending: false })
              .limit(25),
          ])

          // Group by profile (max 10 comments, 5 references each)
          const commentsByProfile = new Map<string, any[]>()
          for (const c of (commentsRes.data || [])) {
            const arr = commentsByProfile.get(c.profile_id) || []
            if (arr.length < 10) { arr.push(c); commentsByProfile.set(c.profile_id, arr) }
          }

          const refsByProfile = new Map<string, any[]>()
          for (const r of (refsRes.data || [])) {
            const arr = refsByProfile.get(r.requester_id) || []
            if (arr.length < 5) { arr.push(r); refsByProfile.set(r.requester_id, arr) }
          }

          const qualData: ProfileQualitativeData[] = topIds.map((pid: string) => {
            const profile = result.results.find((r: any) => r.id === pid)
            return {
              profile_id: pid,
              full_name: profile?.full_name || null,
              role: profile?.role || 'unknown',
              position: profile?.position || null,
              comments: (commentsByProfile.get(pid) || []).map((c: any) => ({
                content: c.content,
                rating: c.rating,
                author_name: c.author?.full_name || null,
                author_role: c.author?.role || null,
              })),
              references: (refsByProfile.get(pid) || []).map((r: any) => ({
                endorsement_text: r.endorsement_text,
                relationship_type: r.relationship_type,
                endorser_name: r.endorser?.full_name || null,
                endorser_role: r.endorser?.role || null,
              })),
            }
          })

          const hasAnyData = qualData.some(p => p.comments.length > 0 || p.references.length > 0)
          if (hasAnyData) {
            const { text: synthesis, meta } = await synthesizeQualitativeInsights(qualData, query)
            synthMeta = meta
            if (synthesis) aiMessage += `\n\n${synthesis}`
          }
        }
      } catch (qualError) {
        // Synthesis is opt-in enrichment; any failure (including provider
        // rate limit) is non-fatal. The user already has RPC results — we
        // just skip the qualitative summary for this response.
        captureException(qualError, { functionName: 'nl-search', correlationId, extra: { phase: 'synthesis' } })
      }
    }

    // ── Phase 6 — rule-based per-row fit_level (replaces composeShortlist) ─
    // The Phase 4 LLM shortlist pass produced non-deterministic tiers (same
    // candidate scored Strong / Good / Needs-info across re-runs) and a
    // summary_message that overrode the deterministic count phrase. Both
    // root-caused the production count-mismatch + tier-flip bugs (B13/B16).
    //
    // Replacement: a deterministic scorer + bio-credential scan (B14). All
    // returned rows already match the search criteria (hard filters in
    // discover_profiles), so this reflects PROFILE STRENGTH only. Same
    // input → same tier, every time. Zero LLM cost. Bio prose (World Cup /
    // NCAA / Pan Am) flows into both bullets and score, closing the
    // "real ceiling" gap where decorated profiles ranked behind weaker ones.
    //
    // Telemetry vars retained at zero — the next clean-up pass can drop the
    // shortlist_* columns from discovery_events once nothing reads them.
    const shortlistMeta: LLMCallMeta | null = null
    const shortlistMalformed = false
    const shortlistByProfileId = new Map<string, unknown>()

    // Phase 3 / Phase 6 — batch-fetch career_history + bios for every
    // result profile (one query each). Highlights + fit_level both consume
    // them, so we share the maps. Non-fatal: a failure just leaves
    // highlights empty and fit_level at "needs_more_info" — never breaks
    // the response.
    const highlightsByProfileId = new Map<string, string[]>()
    const careerByUser = new Map<string, CareerRow[]>()
    const bioByUser = new Map<string, string | null>()
    const bioCredCountByUser = new Map<string, number>()
    try {
      const profileIds = result.results
        .map((r: any) => r?.id)
        .filter((id: unknown): id is string => typeof id === 'string')
      if (profileIds.length > 0) {
        // allSettled — one query failing must not poison the other. A
        // career_history failure would otherwise leave bios un-fetched and
        // collapse every row to "needs_more_info" silently.
        const [careerSettled, bioSettled] = await Promise.allSettled([
          adminClient
            .from('career_history')
            .select('user_id, entry_type, club_name, location_country, highlights, start_date, end_date')
            .in('user_id', profileIds),
          adminClient
            .from('profiles')
            .select('id, bio')
            .in('id', profileIds),
        ])
        if (careerSettled.status === 'fulfilled') {
          for (const row of ((careerSettled.value.data ?? []) as (CareerRow & { user_id: string })[])) {
            const arr = careerByUser.get(row.user_id) ?? []
            arr.push(row)
            careerByUser.set(row.user_id, arr)
          }
        } else {
          captureException(careerSettled.reason, { functionName: 'nl-search', correlationId, extra: { phase: 'career_fetch' } })
        }
        if (bioSettled.status === 'fulfilled') {
          for (const row of ((bioSettled.value.data ?? []) as { id: string; bio: string | null }[])) {
            bioByUser.set(row.id, row.bio ?? null)
            bioCredCountByUser.set(row.id, detectBioCredentials(row.bio).length)
          }
        } else {
          captureException(bioSettled.reason, { functionName: 'nl-search', correlationId, extra: { phase: 'bio_fetch' } })
        }
        for (const r of result.results) {
          if (r?.id) {
            const enriched = { ...r, bio: bioByUser.get(r.id) ?? null }
            highlightsByProfileId.set(r.id, buildProfileHighlights(careerByUser.get(r.id) ?? [], enriched))
          }
        }
      }
    } catch (highlightsError) {
      captureException(highlightsError, {
        functionName: 'nl-search',
        correlationId,
        extra: { phase: 'profile_highlights' },
      })
    }

    const augmentedResults = result.results.map((r: any) => {
      const highlights = r?.id ? highlightsByProfileId.get(r.id) : undefined
      const career = r?.id ? (careerByUser.get(r.id) ?? []) : []
      const bioCredCount = r?.id ? (bioCredCountByUser.get(r.id) ?? 0) : 0
      const fit_level = fitLevelForDiscoverResult(r, career, bioCredCount)
      const withHighlights = highlights && highlights.length > 0 ? { ...r, highlights } : r
      return { ...withHighlights, fit_level }
    })

    // Phase 1c — a compound multi-role search gets its own message: the
    // per-role breakdown ("2 players and 1 coach") can't be expressed
    // through enforcedRole's single noun. Set last so it also wins over any
    // composeShortlist summary_message applied above.
    if (isCompound && result.total > 0) {
      aiMessage = buildCompoundMessage(roleCounts, result.results)
    }

    // Production audit fix — the LLM parse often emits only one role for
    // a compound query ("3 players and 1 coach" → roles:['player']), so
    // the "Filters applied" chip strip missed Coach. Overwrite parsed.roles
    // with the actual roles searched so the chips match the results.
    if (isCompound) {
      parsed.roles = Array.from(new Set(roleCounts.map(rc => rc.role)))
    }

    // ── Phase 1A envelope: build applied + kind + suggested_actions ──────
    // The applied block summarizes what was actually searched in human-readable
    // form. The new frontend uses this for the no-results card; old frontend
    // ignores it. role_summary is the single field most likely to be embedded
    // verbatim into UI copy ("I searched for {role_summary} based on your
    // profile...").
    const ENTITY_PLURAL: Record<string, AppliedSearch['entity']> = {
      player: 'players',
      coach: 'coaches',
      club: 'clubs',
      brand: 'brands',
      umpire: 'umpires',
    }
    const appliedEntity = enforcedRole ? ENTITY_PLURAL[enforcedRole] ?? null : null
    const applied: AppliedSearch = {
      entity: appliedEntity,
      // Phase 3e — primary label is the hockey category. Legacy gender_label
      // is still populated for one cycle so frontends mid-deploy don't show
      // empty chips for adult_men/adult_women.
      category_label: effectiveCategory,
      gender_label: effectiveGender,
      location_label: baseLocationText,
      age: (parsed.min_age != null || parsed.max_age != null)
        ? { min: parsed.min_age, max: parsed.max_age }
        : undefined,
      role_summary: '',
    }
    applied.role_summary = buildRoleSummary(applied)

    const responseKind: ResponseKind = result.total === 0 ? 'no_results' : 'results'
    // Chips only on no_results in PR-1 (refine chips for results land in Package B).
    let suggestedActions: SuggestedAction[] = responseKind === 'no_results'
      ? getNoResultsActions(applied, userContext?.role ?? null)
      : []
    // Phase 4 — when the no-results compose pass produced a concrete
    // follow-up query, prepend it as the lead chip. The deterministic
    // catalog stays as supporting actions — but the LLM's contextual
    // suggestion ("Want me to search clubs in Spain anyway?") is the
    // most actionable and goes first.
    if (noResultsFollowUpQuery) {
      // Truncate the chip label to keep the strip tidy. The full query
      // still goes to the backend on tap.
      const label = noResultsFollowUpQuery.length > 38
        ? noResultsFollowUpQuery.slice(0, 35).trim() + '…'
        : noResultsFollowUpQuery
      const followUpAction: SuggestedAction = {
        label,
        intent: { type: 'free_text', query: noResultsFollowUpQuery },
      }
      suggestedActions = [followUpAction, ...suggestedActions].slice(0, 4)
    }

    // ── Analytics logging ────────────────────────────────────────────────
    // Phase 0 enrichment: stash the routing decision into parsed_filters._meta
    // so we can prove (or disprove) that the keyword router is actually
    // overriding the LLM and producing entity-pure results.
    const parsedWithMeta = {
      ...parsed,
      _meta: {
        router_entity_type: intent.entity_type,
        router_confidence: intent.confidence,
        router_signals: intent.matched_signals,
        llm_selected_tool: llmSelectedTool,
        backend_forced_search: backendForcedSearch,
        forced_entity_type: backendForcedSearch ? intent.entity_type : null,
        forced_reason: forcedReason,
        enforced_role: enforcedRole,
        filter_source: filterSource,
        category_source: categorySource,
        gender_source: categorySource,  // alias kept for telemetry continuity
        effective_roles: effectiveRoles,
        effective_category: effectiveCategory,
        effective_gender: effectiveGender,
        // Phase 1A telemetry additions
        kind: responseKind,
        applied_role_summary: applied.role_summary,
        suggested_actions_count: suggestedActions.length,
        // Phase 4 MVP-A telemetry — shortlist composition
        shortlist_used: shortlistByProfileId.size > 0,
        shortlist_rows_returned: shortlistByProfileId.size,
        shortlist_malformed: shortlistMalformed,
        // Phase 4 — no-results compose telemetry
        no_results_composed: result.total === 0 && !!noResultsMeta,
        no_results_follow_up: noResultsFollowUpQuery !== null,
      },
    }
    fireAndForget(logDiscoveryEvent(adminClient, {
      user_id: user.id,
      role: userContext?.role ?? null,
      query_text: query,
      intent: 'search',
      parsed_filters: parsedWithMeta as any,
      result_count: result.total,
      has_qualitative: llmResult.include_qualitative === true && result.results.length > 0,
      llm_provider: llmProvider,
      response_time_ms: Date.now() - startTime,
      error_message: null,
      // Phase 4 — sum tokens across all 4 LLM passes (parse + synth +
      // shortlist + no_results) so cost-per-query stays comparable across
      // provider switches.
      prompt_tokens: sumNullable(sumNullable(sumNullable(parseMeta.usage?.prompt_tokens ?? null, synthMeta?.usage?.prompt_tokens ?? null), shortlistMeta?.usage?.prompt_tokens ?? null), noResultsMeta?.usage?.prompt_tokens ?? null),
      completion_tokens: sumNullable(sumNullable(sumNullable(parseMeta.usage?.completion_tokens ?? null, synthMeta?.usage?.completion_tokens ?? null), shortlistMeta?.usage?.completion_tokens ?? null), noResultsMeta?.usage?.completion_tokens ?? null),
      cached_tokens: sumNullable(sumNullable(sumNullable(parseMeta.usage?.cached_tokens ?? null, synthMeta?.usage?.cached_tokens ?? null), shortlistMeta?.usage?.cached_tokens ?? null), noResultsMeta?.usage?.cached_tokens ?? null),
      prompt_version: PROMPT_VERSION,
      fallback_used: false,
      retry_count: parseMeta.retry_count + (synthMeta?.retry_count ?? 0) + (shortlistMeta?.retry_count ?? 0) + (noResultsMeta?.retry_count ?? 0),
    }))

    // ── Response ────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        data: augmentedResults,
        total: result.total,
        has_more: result.has_more,
        parsed_filters: parsed,
        summary: parsed.summary || `Found ${result.total} result${result.total === 1 ? '' : 's'}.`,
        ai_message: aiMessage,
        // Phase 1A envelope additions (PR-1, additive only).
        kind: responseKind,
        applied,
        suggested_actions: suggestedActions,
        // Phase 4 audit — frontend uses this to skip the collapse-to-3
        // when the user explicitly asked for mixed roles ("3 players and
        // 1 coach"), so the headline count matches what's visible.
        is_compound: isCompound,
      }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error')
    captureException(err, { functionName: 'nl-search', correlationId })

    // If all prerequisites were validated before the failure, attempt a
    // graceful keyword-search fallback. Covers LLM timeouts, provider
    // rate-limits, transient 5xx, and unexpected LLM errors alike.
    if (pendingQuery && pendingUserId && pendingAdminClient) {
      // PR-4 QA fix: keyword fallback only applies to search-shaped intents.
      // Knowledge / self_advice / self_profile / greeting / unknown intents
      // would land on a no_results card with unrelated chips ("Show all clubs"
      // for a "what is a penalty corner?" query). For those, return
      // soft_error directly so the user gets calm copy + retry chips.
      const NON_SEARCH_INTENTS = new Set(['knowledge', 'self_advice', 'self_profile', 'greeting'])
      if (pendingIntentEntityType && NON_SEARCH_INTENTS.has(pendingIntentEntityType)) {
        const softErrorActions = pendingIsRepeatSoftError
          ? getRepeatedSoftErrorActions()
          : getSoftErrorActions()
        const softErrorMessage = pendingIsRepeatSoftError
          ? "That still didn't go through. Let's try a simpler path."
          : "I had trouble generating that answer. Want to try again, or ask something else?"
        fireAndForget(logDiscoveryEvent(pendingAdminClient, {
          user_id: pendingUserId,
          role: pendingUserRole,
          query_text: pendingQuery,
          intent: 'error',
          parsed_filters: { _meta: { kind: 'soft_error', error_phase: 'llm_non_search', repeated: pendingIsRepeatSoftError, suggested_actions_count: softErrorActions.length, intent_entity_type: pendingIntentEntityType } } as any,
          result_count: 0,
          has_qualitative: false,
          llm_provider: llmProvider,
          response_time_ms: Date.now() - startTime,
          error_message: err.message,
          prompt_tokens: null,
          completion_tokens: null,
          cached_tokens: null,
          prompt_version: PROMPT_VERSION,
          fallback_used: false,
          retry_count: 0,
        }))
        return new Response(
          JSON.stringify({
            success: true,
            data: [],
            total: 0,
            has_more: false,
            parsed_filters: null,
            summary: null,
            ai_message: softErrorMessage,
            kind: 'soft_error' as ResponseKind,
            applied: null,
            suggested_actions: softErrorActions,
          }),
          { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }
      return runKeywordFallback({
        adminClient: pendingAdminClient,
        rawQuery: pendingQuery,
        userId: pendingUserId,
        userRole: pendingUserRole,
        startTime,
        llmProvider,
        originalError: err,
        parseRetryCount: 0,
        headers,
        correlationId,
        isRepeatSoftError: pendingIsRepeatSoftError,
        offset: pendingOffset,
      })
    }

    // Failed before the query was validated — nothing to fall back to.
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }
})
