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
import { parseSearchQuery, synthesizeQualitativeInsights, composeShortlist, composeNoResults, answerPlatformHelp, PROMPT_VERSION, type LLMCallMeta, type ParsedFilters, type HistoryTurn, type ProfileQualitativeData, type ShortlistCandidate, type ShortlistRow, type UserContext } from '../_shared/llm-client.ts'
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

/** Parse a count token (digits or a number word) → positive integer | null. */
function parseCountToken(token: string): number | null {
  const t = token.toLowerCase()
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return NUMBER_WORDS[t] ?? null
}

/**
 * Resolve how many results a search should return.
 *
 * When the user names an explicit count — "show me 10 players", "top five
 * clubs", "find three coaches" — honour it, clamped to MAX_RESULT_LIMIT.
 * Both digits and number words are understood. With no number, return
 * DEFAULT_RESULT_LIMIT ("the best 5 first") rather than a long default list.
 *
 * The number must sit next to a result noun (within 3 words), and a number
 * immediately followed by an age word is ignored — so "25 year old
 * players", "U25 defenders" and "2+ references" never read as a count.
 */
function resolveResultLimit(rawQuery: string): number {
  const noun = 'players?|coaches?|clubs?|brands?|umpires?|profiles?|results?|people|users?|options?|matches'
  const m =
    rawQuery.match(
      new RegExp(`\\b(${NUMBER_TOKEN})\\s+(?!years?\\b|yo\\b|yr\\b)${COUNT_FILLER}(?:${noun})\\b`, 'i'),
    ) ||
    rawQuery.match(new RegExp(`\\b(?:top|best|first)\\s+(${NUMBER_TOKEN})\\b`, 'i'))
  if (m) {
    const n = parseCountToken(m[1])
    if (n != null && n > 0) return Math.min(n, MAX_RESULT_LIMIT)
  }
  return DEFAULT_RESULT_LIMIT
}

/** Result-noun → canonical role. Drives compound multi-role detection. */
const ROLE_NOUNS: Record<string, string> = {
  player: 'player', players: 'player',
  coach: 'coach', coaches: 'coach',
  club: 'club', clubs: 'club',
  brand: 'brand', brands: 'brand',
  umpire: 'umpire', umpires: 'umpire',
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
 * Phase 1c — extract every explicit "<count> <role>" pair from a query, in
 * order, de-duplicated by role: "Find me 2 players and 1 coach" →
 * [{role:'player',count:2},{role:'coach',count:1}]. Two or more pairs makes
 * it a compound multi-role search. Age phrases ("25 year old players") are
 * excluded the same way resolveResultLimit does.
 */
function extractRoleCounts(rawQuery: string): { role: string; count: number }[] {
  const nouns = Object.keys(ROLE_NOUNS).join('|')
  const re = new RegExp(
    `\\b(${NUMBER_TOKEN})\\s+(?!years?\\b|yo\\b|yr\\b)${COUNT_FILLER}(${nouns})\\b`,
    'gi',
  )
  const out: { role: string; count: number }[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(rawQuery)) !== null) {
    const count = parseCountToken(m[1])
    const role = ROLE_NOUNS[m[2].toLowerCase()]
    if (role && count != null && count > 0 && !seen.has(role)) {
      seen.add(role)
      out.push({ role, count: Math.min(count, MAX_RESULT_LIMIT) })
    }
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
  roleCounts: { role: string; count: number }[],
  rows: { role?: string }[],
): string {
  const present: string[] = []
  const absent: string[] = []
  for (const rc of roleCounts) {
    const got = rows.filter(r => r.role === rc.role).length
    if (got > 0) present.push(`${got} ${roleLabel(rc.role, got)}`)
    else absent.push(roleLabel(rc.role, 2))
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
  result: { accepted_reference_count?: number; open_to_opportunities?: boolean },
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

  // 2. Club experience — up to two most-recent clubs.
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

  // 3. Verified references.
  const refs = result.accepted_reference_count ?? 0
  if (refs > 0) add(`${refs} accepted reference${refs === 1 ? '' : 's'}`)

  // 4. Stated achievements from Journey entries.
  for (const e of sorted) {
    for (const h of (e.highlights ?? [])) add(h)
  }

  // 5. Journey depth.
  if (career.length >= 3) add(`${career.length} Journey entries`)

  // 6. Open to new opportunities.
  if (result.open_to_opportunities) add('Open to new opportunities')

  return out.slice(0, 4)
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
        .limit(20)

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
          p_positions: rc.role === 'player' ? baseDiscoverParams.p_positions : null,
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
      const countPhrase = `I found ${shown} ${noun} for you.`
      aiMessage = llmResult.message ? `${countPhrase} ${llmResult.message}` : countPhrase
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

    // ── Phase 4 MVP-A: compose per-row shortlist ─────────────────────
    // For any non-empty result set, run a 2nd LLM pass that scores each
    // row's fit against the search criteria and surfaces concrete missing
    // data + a next action per row. The output rides on `data[i]` as
    // additive fields — old frontends ignore them, the Phase 4 frontend
    // renders them. Failure is non-fatal: we keep the original results.
    let shortlistMeta: LLMCallMeta | null = null
    let shortlistMalformed = false
    const shortlistByProfileId = new Map<string, ShortlistRow>()
    if (result.results.length > 0) {
      try {
        const top = result.results.slice(0, 5)

        // F1 fix: eu_passport is NOT projected by discover_profiles. Compute
        // it per-row by looking up nationality codes from the countries
        // table and matching against EU_PASSPORT_CODES. Without this, every
        // candidate is told to the LLM as eu_passport=false, which silently
        // wrecks fit reasoning on EU-passport-targeted searches.
        const nationalityIds = new Set<number>()
        for (const r of top) {
          if (typeof r.nationality_country_id === 'number') nationalityIds.add(r.nationality_country_id)
          if (typeof r.nationality2_country_id === 'number') nationalityIds.add(r.nationality2_country_id)
        }
        const codeByCountryId = new Map<number, string>()
        if (nationalityIds.size > 0) {
          const { data: nationalityRows } = await adminClient
            .from('countries')
            .select('id, code')
            .in('id', Array.from(nationalityIds))
          for (const c of (nationalityRows || []) as Array<{ id: number; code: string }>) {
            codeByCountryId.set(c.id, c.code)
          }
        }
        const rowHasEuPassport = (r: any): boolean => {
          const code1 = typeof r.nationality_country_id === 'number' ? codeByCountryId.get(r.nationality_country_id) : undefined
          const code2 = typeof r.nationality2_country_id === 'number' ? codeByCountryId.get(r.nationality2_country_id) : undefined
          return (code1 != null && EU_PASSPORT_CODES.has(code1)) || (code2 != null && EU_PASSPORT_CODES.has(code2))
        }

        const candidates: ShortlistCandidate[] = top.map((r: any) => {
          // F5 fix: render coach_specialization as a human label, not the
          // raw enum value. Custom value (free text) takes precedence.
          const customSpec = (r.coach_specialization_custom as string | null)?.trim() || null
          const enumSpec = r.coach_specialization as string | null
          const coachSpec = customSpec
            || (enumSpec ? (COACH_SPECIALIZATION_LABEL[enumSpec] ?? enumSpec) : null)

          return {
            profile_id: r.id,
            full_name: r.full_name ?? null,
            role: r.role ?? 'unknown',
            position: r.position ?? null,
            secondary_position: r.secondary_position ?? null,
            // Phase 3e — playing_category is primary; coach/umpire use
            // their respective arrays. We send a single representative
            // category string to keep the shortlist prompt compact.
            category: (r.playing_category
              ?? (Array.isArray(r.coaching_categories) && r.coaching_categories.length > 0 ? r.coaching_categories.join(', ') : null)
              ?? (Array.isArray(r.umpiring_categories) && r.umpiring_categories.length > 0 ? r.umpiring_categories.join(', ') : null)
              ?? null) as string | null,
            age: r.age ?? null,
            base_country: r.base_country_name ?? null,
            nationality: r.nationality_name ?? null,
            nationality2: r.nationality2_name ?? null,
            eu_passport: rowHasEuPassport(r),
            current_club: r.current_club ?? null,
            open_to_play: !!r.open_to_play,
            open_to_coach: !!r.open_to_coach,
            open_to_opportunities: !!r.open_to_opportunities,
            reference_count: r.accepted_reference_count ?? 0,
            career_entry_count: r.career_entry_count ?? 0,
            coach_specialization: coachSpec,
          }
        })

        const { result: shortlistResult, meta: smeta } = await composeShortlist(candidates, parsed, query)
        shortlistMeta = smeta

        // Validate + index the shortlist by profile_id. If the LLM omitted
        // rows or returned IDs that don't match, log it and degrade
        // gracefully — the empty Map below means rows just don't get
        // augmented (existing behavior), no breakage.
        if (Array.isArray(shortlistResult.shortlist) && shortlistResult.shortlist.length === candidates.length) {
          for (const row of shortlistResult.shortlist) {
            if (row?.profile_id) shortlistByProfileId.set(row.profile_id, row)
          }
          if (shortlistByProfileId.size !== candidates.length) {
            shortlistMalformed = true
          }
        } else {
          shortlistMalformed = true
        }

        // Replace the templated aiMessage with the LLM's summary_message
        // when present and non-empty. This is the brief's hero behavior:
        // "I found 8 possible matches — the strongest 3 are listed first..."
        if (shortlistResult.summary_message?.trim()) {
          aiMessage = shortlistResult.summary_message.trim()
        }
      } catch (shortlistError) {
        // Compose pass is non-fatal. Log and continue with current behavior.
        captureException(shortlistError, { functionName: 'nl-search', correlationId, extra: { phase: 'compose_shortlist' } })
        shortlistMalformed = true
      }
    }

    // Augment each result row with its shortlist analysis (if present).
    // Additive — old frontends see the same shape with extra optional fields,
    // Phase 4 frontend renders them.
    // Phase 3 — rule-based Journey highlights. Batch-fetch career_history
    // for every result profile in one query and derive up to 4 concrete
    // highlights each. Non-fatal: a failure just leaves highlights empty.
    const highlightsByProfileId = new Map<string, string[]>()
    try {
      const profileIds = result.results
        .map((r: any) => r?.id)
        .filter((id: unknown): id is string => typeof id === 'string')
      if (profileIds.length > 0) {
        const { data: careerRows } = await adminClient
          .from('career_history')
          .select('user_id, entry_type, club_name, location_country, highlights, start_date, end_date')
          .in('user_id', profileIds)
        const careerByUser = new Map<string, CareerRow[]>()
        for (const row of ((careerRows ?? []) as (CareerRow & { user_id: string })[])) {
          const arr = careerByUser.get(row.user_id) ?? []
          arr.push(row)
          careerByUser.set(row.user_id, arr)
        }
        for (const r of result.results) {
          if (r?.id) {
            highlightsByProfileId.set(r.id, buildProfileHighlights(careerByUser.get(r.id) ?? [], r))
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
      const sl = r?.id ? shortlistByProfileId.get(r.id) : undefined
      const highlights = r?.id ? highlightsByProfileId.get(r.id) : undefined
      const withHighlights = highlights && highlights.length > 0 ? { ...r, highlights } : r
      if (!sl) return withHighlights
      return {
        ...withHighlights,
        fit_level: sl.fit_level,
        fit_reasons: sl.fit_reasons,
        missing_data: sl.missing_data,
        next_action: sl.next_action,
      }
    })

    // Phase 1c — a compound multi-role search gets its own message: the
    // per-role breakdown ("2 players and 1 coach") can't be expressed
    // through enforcedRole's single noun. Set last so it also wins over any
    // composeShortlist summary_message applied above.
    if (isCompound && result.total > 0) {
      aiMessage = buildCompoundMessage(roleCounts, result.results)
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
