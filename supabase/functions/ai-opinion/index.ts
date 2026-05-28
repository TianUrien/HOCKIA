/**
 * ai-opinion — Section F AI Opinion Engine (recruitment spec G.7)
 *
 * Phase 1 Session B. See docs/SECTION_F_AI_OPINION_ENGINE_PROPOSAL.md
 * for design intent + the 6 open decisions and their agreed defaults.
 *
 * Request shape:
 *   POST /functions/v1/ai-opinion
 *   Authorization: Bearer <user JWT>
 *   Body: { player_id: uuid }
 *
 * Response shape:
 *   200 { verdict_short, citations: [{ field, value, claim }], cached, quota_remaining }
 *   401 { error: 'unauthenticated' }
 *   403 { error: 'recruiter_only' | 'not_applicable' }
 *   429 { error: 'quota_exceeded', resets_at }
 *   500 { error: 'internal' }
 *
 * Behaviour:
 *   1. Auth check (must be authenticated club/coach).
 *   2. Resolve viewer's effective target (override from recruiting_context
 *      or profile-derived for clubs). Same logic as clubFit.ts.
 *   3. Fetch viewer + player facts + both sides' league bands.
 *   4. Compute deterministic Fit math (mirror of clubFit.ts).
 *   5. Compute context_hash. Cache lookup on ai_opinions —
 *      same viewer+player+hash AND not expired → return cached.
 *   6. Cache miss: check per-viewer daily quota in ai_opinion_quota.
 *      If >= 50 → 429.
 *   7. Build structured prompt, call Claude Sonnet, parse JSON output.
 *   8. Content filter (closed vocabulary) — reject if banned words.
 *   9. UPSERT into ai_opinions; increment ai_opinion_quota; return.
 *
 * Prompt v1.0 — FIRST DRAFT. Review docs/SECTION_F_AI_OPINION_ENGINE_PROPOSAL.md
 * before this is deployed to staging.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'

// ── Prompt version + constants ──────────────────────────────────────
// Bump PROMPT_VERSION when the system prompt or output schema changes
// in a way that should invalidate cached opinions. ai_opinions cache
// keys include this — bumping forces a full regenerate next read.
const PROMPT_VERSION = 'v1.0.draft'
const MODEL = 'claude-sonnet-4-6'
const VERDICT_MAX_CHARS = 280
const QUOTA_PER_DAY = 50

// Words the LLM must NOT use — judgment about the PERSON, not the
// MATCH. Stays small Phase 1; tighten via staging review.
const BANNED_WORDS = [
  'elite',
  'star',
  'generational',
  'talented',
  'gifted',
  'amazing',
  'incredible',
  'world-class',
  'phenomenal',
  'exceptional',
  'genius',
]

// ── Types ───────────────────────────────────────────────────────────
interface Citation {
  field: string
  value: string
  claim: string
}

interface OpinionPayload {
  verdict_short: string
  citations: Citation[]
}

interface FitContext {
  viewer_target: 'Men' | 'Women' | 'Mixed' | null
  viewer_band: number | null
  player_category: string | null
  player_band: number | null
  player_open_to_play: boolean | null
  player_open_to_coach: boolean | null
  player_open_to_opportunities: boolean | null
  player_last_active_at: string | null
}

// ── sha256 hash via Web Crypto (Deno) ──────────────────────────────
// NOT MD5: Deno's Web Crypto API follows the spec strictly and only
// supports SHA-1/256/384/512. Earlier this function used MD5 which
// throws DOMException, killing the handler before the success path
// could return a CORS-headed response — surfaced to the browser as
// `FunctionsFetchError: Failed to send a request to the Edge
// Function` (QA F1 on staging). Truncating SHA-256 to 32 hex chars
// gives an identically-shaped cache key without changing the schema.
async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function computeContextHash(viewerId: string, playerId: string, fit: FitContext): Promise<string> {
  // Includes everything that would change the verdict. When ANY input
  // changes the hash differs → cache miss → fresh generation.
  const payload = JSON.stringify({
    v: viewerId,
    p: playerId,
    vt: fit.viewer_target,
    vb: fit.viewer_band,
    pc: fit.player_category,
    pb: fit.player_band,
    op: fit.player_open_to_play,
    oc: fit.player_open_to_coach,
    oo: fit.player_open_to_opportunities,
    pv: PROMPT_VERSION,
  })
  return sha256(payload)
}

// ── Viewer + player profile fetch ───────────────────────────────────
interface ProfileRow {
  id: string
  role: string
  full_name: string | null
  current_world_club_id: string | null
  playing_category: string | null
  coaching_categories: string[] | null
  open_to_play: boolean | null
  open_to_coach: boolean | null
  open_to_opportunities: boolean | null
  last_active_at: string | null
  accepted_reference_count: number | null
  career_entry_count: number | null
  highlight_video_url: string | null
  full_game_video_count: number | null
  current_club: string | null
}

async function fetchProfile(supabase: ReturnType<typeof getServiceClient>, id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, current_world_club_id, playing_category, coaching_categories, open_to_play, open_to_coach, open_to_opportunities, last_active_at, accepted_reference_count, career_entry_count, highlight_video_url, full_game_video_count, current_club')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as ProfileRow | null
}

// ── World-club join: derive competition level band per side ─────────
// Mirrors the SQL in get_top_community_members RPC: read men's band
// when player is men/boys, women's band when women/girls, COALESCE
// either way as fallback.
async function fetchLevelBand(
  supabase: ReturnType<typeof getServiceClient>,
  worldClubId: string | null,
  category: string | null,
): Promise<number | null> {
  if (!worldClubId) return null
  const { data, error } = await supabase
    .from('world_clubs')
    .select('men_league_id, women_league_id')
    .eq('id', worldClubId)
    .maybeSingle()
  if (error || !data) return null
  const club = data as { men_league_id: string | null; women_league_id: string | null }
  const wantWomen = category === 'adult_women' || category === 'girls'
  const primaryId = wantWomen ? club.women_league_id : club.men_league_id
  const fallbackId = wantWomen ? club.men_league_id : club.women_league_id
  const targetId = primaryId ?? fallbackId
  if (!targetId) return null
  const { data: league } = await supabase
    .from('world_leagues')
    .select('level_band_global')
    .eq('id', targetId)
    .maybeSingle()
  return (league as { level_band_global: number | null } | null)?.level_band_global ?? null
}

// ── Effective recruiting target ─────────────────────────────────────
async function resolveTarget(
  supabase: ReturnType<typeof getServiceClient>,
  viewerId: string,
  viewerRole: string,
): Promise<'Men' | 'Women' | 'Mixed' | null> {
  // Active recruiting_context wins if present (clubs auto-seed, coaches
  // opt-in via ContextSwitcher).
  const { data: ctx } = await supabase
    .from('recruiting_context')
    .select('target_category')
    .eq('owner_id', viewerId)
    .eq('is_active', true)
    .maybeSingle()
  const override = (ctx as { target_category: string | null } | null)?.target_category as
    | 'Men' | 'Women' | 'Mixed' | null
    | undefined
  if (override) return override

  // Clubs: derive from profile's league divisions (men's / women's).
  // Coaches: no profile-derived target — return null if no override.
  if (viewerRole !== 'club') return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('mens_league_division, womens_league_division')
    .eq('id', viewerId)
    .maybeSingle()
  const p = profile as { mens_league_division: string | null; womens_league_division: string | null } | null
  const hasMen = Boolean(p?.mens_league_division)
  const hasWomen = Boolean(p?.womens_league_division)
  if (hasMen && hasWomen) return 'Mixed'
  if (hasMen) return 'Men'
  if (hasWomen) return 'Women'
  return null
}

// ── Prompt v1.0 (FIRST DRAFT — review before deploy) ────────────────
const SYSTEM_PROMPT = `You are HOCKIA AI's recruitment opinion engine. You produce short, evidence-based verdicts on player↔club fit for field-hockey recruiters.

RULES (non-negotiable):
1. Opinions are about the MATCH, never about the PERSON. ❌ "Maria is talented" ✅ "Maria's full-match footage at Hoofdklasse level matches your team's competition tier."
2. Every claim must cite a specific player profile field. No floating assertions.
3. Closed vocabulary. Do NOT use: elite, star, generational, talented, gifted, amazing, incredible, world-class, phenomenal, exceptional, genius. Describe the FIT, not the PLAYER.
4. Maximum ${VERDICT_MAX_CHARS} characters for verdict_short. 1-2 sentences total.
5. Output JSON only. No prose outside the JSON object.

OUTPUT SCHEMA (strict):
{
  "verdict_short": "1-2 sentences about the MATCH",
  "citations": [
    { "field": "<profile field name>", "value": "<actual value>", "claim": "<what this evidences about the fit>" }
  ]
}

CITATION RULES:
- Each citation must reference a real field from the input (e.g. competition_level_band, accepted_reference_count, open_to_play).
- "claim" describes what the field EVIDENCES about fit, not about the player.
- At least 1 citation, at most 4. Pick the most decisive ones.

FIT-MATH CONTEXT:
You are given a deterministic Fit calculation. Treat it as ground truth. Your job is to translate the inputs into recruiter-readable language.

If insufficient information (e.g., no playing_category, no level_band on either side, no openness signals), respond with a verdict explaining what's missing and an empty citations array.`

function buildUserPrompt(viewer: ProfileRow, player: ProfileRow, fit: FitContext): string {
  return JSON.stringify({
    viewer_role: viewer.role,
    viewer_target_category: fit.viewer_target,
    viewer_competition_level_band: fit.viewer_band,
    player: {
      role: player.role,
      playing_category: fit.player_category,
      competition_level_band: fit.player_band,
      current_club: player.current_club,
      open_to_play: fit.player_open_to_play,
      open_to_coach: fit.player_open_to_coach,
      open_to_opportunities: fit.player_open_to_opportunities,
      last_active_at: fit.player_last_active_at,
      accepted_reference_count: player.accepted_reference_count ?? 0,
      career_entry_count: player.career_entry_count ?? 0,
      has_highlight_video: Boolean(player.highlight_video_url?.trim()),
      full_match_video_count: player.full_game_video_count ?? 0,
    },
  }, null, 2)
}

// ── Claude Sonnet call (inline, no shared helper) ───────────────────
async function callClaude(systemPrompt: string, userPrompt: string): Promise<OpinionPayload> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      // Prompt caching: the system prompt is ~600 tokens of identical
      // RULES + SCHEMA on every call — cache it so we only pay full
      // input cost once per 5-minute window. User prompt is per-call.
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Anthropic API error (${response.status}): ${body}`)
  }
  const data = await response.json() as { content: Array<{ type: string; text?: string }> }
  // Extract text content. Claude returns content[].text for text blocks.
  const text = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()
  // Strip ```json fences if Claude wraps the output despite "JSON only" rule.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error(`Claude returned non-JSON output: ${text.slice(0, 200)}`)
  }
  // Shape validation
  const obj = parsed as Record<string, unknown>
  const verdict = typeof obj.verdict_short === 'string' ? obj.verdict_short : ''
  const rawCitations = Array.isArray(obj.citations) ? obj.citations : []
  const citations: Citation[] = rawCitations
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      field: typeof c.field === 'string' ? c.field : '',
      value: typeof c.value === 'string' ? c.value : String(c.value ?? ''),
      claim: typeof c.claim === 'string' ? c.claim : '',
    }))
    .filter((c) => c.field && c.claim)
  if (!verdict || verdict.length > VERDICT_MAX_CHARS) {
    throw new Error(`Invalid verdict_short: empty or > ${VERDICT_MAX_CHARS} chars`)
  }
  return { verdict_short: verdict, citations }
}

// ── Content filter: enforce closed vocabulary ───────────────────────
function passesContentFilter(payload: OpinionPayload): { ok: boolean; reason?: string } {
  const haystack = [
    payload.verdict_short,
    ...payload.citations.map((c) => c.claim),
  ].join(' ').toLowerCase()
  for (const banned of BANNED_WORDS) {
    if (new RegExp(`\\b${banned}\\b`, 'i').test(haystack)) {
      return { ok: false, reason: `banned vocabulary: ${banned}` }
    }
  }
  return { ok: true }
}

// ── HTTP handler ────────────────────────────────────────────────────
serve(async (req: Request) => {
  // CORS headers must be resolved BEFORE any work that could throw —
  // the outer try/catch below uses them to return a CORS-headed 500
  // when something unexpected happens. Without that, the browser
  // surfaces the failure as `FunctionsFetchError: Failed to send a
  // request to the Edge Function` (QA F1) instead of giving the
  // client a clean error code + message to render in the UI.
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {

  const supabase = getServiceClient()

  // 1) Auth check — must be authenticated.
  const authHeader = req.headers.get('Authorization')
  const jwt = authHeader?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const viewerId = userData.user.id

  // 2) Parse + validate request body.
  let playerId: string
  try {
    const body = await req.json() as { player_id?: string }
    if (!body.player_id || typeof body.player_id !== 'string') throw new Error()
    playerId = body.player_id
  } catch {
    return new Response(JSON.stringify({ error: 'missing_player_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (playerId === viewerId) {
    return new Response(JSON.stringify({ error: 'no_self_opinion' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 3) Fetch viewer + player profiles in parallel.
  const [viewer, player] = await Promise.all([
    fetchProfile(supabase, viewerId),
    fetchProfile(supabase, playerId),
  ])
  if (!viewer || !player) {
    return new Response(JSON.stringify({ error: 'profile_not_found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 4) Recruiter gate — club or coach only (matches ClubFitChip + spec).
  if (viewer.role !== 'club' && viewer.role !== 'coach') {
    return new Response(JSON.stringify({ error: 'recruiter_only' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 5) Resolve effective target + both sides' level bands.
  const viewerTarget = await resolveTarget(supabase, viewerId, viewer.role)
  if (!viewerTarget) {
    return new Response(JSON.stringify({ error: 'not_applicable', detail: 'no recruiting target — set a context via the chip' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const [viewerBand, playerBand] = await Promise.all([
    fetchLevelBand(supabase, viewer.current_world_club_id, viewerTarget === 'Women' ? 'adult_women' : 'adult_men'),
    fetchLevelBand(supabase, player.current_world_club_id, player.playing_category),
  ])
  const fit: FitContext = {
    viewer_target: viewerTarget,
    viewer_band: viewerBand,
    player_category: player.playing_category,
    player_band: playerBand,
    player_open_to_play: player.open_to_play,
    player_open_to_coach: player.open_to_coach,
    player_open_to_opportunities: player.open_to_opportunities,
    player_last_active_at: player.last_active_at,
  }

  // 6) Compute hash + cache check.
  const contextHash = await computeContextHash(viewerId, playerId, fit)
  const { data: cached } = await supabase
    .from('ai_opinions')
    .select('verdict_short, citations, expires_at')
    .eq('viewer_id', viewerId)
    .eq('player_id', playerId)
    .eq('context_hash', contextHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (cached) {
    const c = cached as { verdict_short: string; citations: Citation[] }
    return new Response(JSON.stringify({
      verdict_short: c.verdict_short,
      citations: c.citations,
      cached: true,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 7) Cache miss — quota check before paying the LLM.
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC
  const { data: quotaRow } = await supabase
    .from('ai_opinion_quota')
    .select('count')
    .eq('viewer_id', viewerId)
    .eq('day', today)
    .maybeSingle()
  const used = (quotaRow as { count: number } | null)?.count ?? 0
  if (used >= QUOTA_PER_DAY) {
    return new Response(JSON.stringify({
      error: 'quota_exceeded',
      resets_at: `${today}T23:59:59Z`,
      quota_per_day: QUOTA_PER_DAY,
    }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 8) LLM call + content filter.
  const userPrompt = buildUserPrompt(viewer, player, fit)
  let payload: OpinionPayload
  try {
    payload = await callClaude(SYSTEM_PROMPT, userPrompt)
  } catch (err) {
    console.error('[ai-opinion] LLM call failed', err)
    return new Response(JSON.stringify({ error: 'llm_failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const filter = passesContentFilter(payload)
  if (!filter.ok) {
    console.error('[ai-opinion] content filter rejected', filter.reason, payload.verdict_short)
    return new Response(JSON.stringify({ error: 'content_filter_rejected', detail: filter.reason }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 9) Persist + increment quota. Best-effort — failures here don't
  // block the response (the recruiter still gets their verdict).
  try {
    await supabase.from('ai_opinions').upsert({
      viewer_id: viewerId,
      player_id: playerId,
      context_hash: contextHash,
      verdict_short: payload.verdict_short,
      citations: payload.citations,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'viewer_id,player_id,context_hash' })
    await supabase.from('ai_opinion_quota').upsert({
      viewer_id: viewerId,
      day: today,
      count: used + 1,
    }, { onConflict: 'viewer_id,day' })
  } catch (err) {
    console.error('[ai-opinion] persist failed (response still returned)', err)
  }

  return new Response(JSON.stringify({
    verdict_short: payload.verdict_short,
    citations: payload.citations,
    cached: false,
    quota_remaining: QUOTA_PER_DAY - used - 1,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  } catch (err) {
    // Top-level safety net. Any uncaught throw — bad UUID coerce in a
    // supabase query, a runtime DOMException from Web Crypto, a parse
    // bug we didn't anticipate — lands here so the client gets a
    // CORS-headed 500 with a stable error code, never a fetch-layer
    // failure. The QA pass (F1) explicitly called out the missing
    // catch as the reason `FunctionsFetchError: Failed to send a
    // request` was reaching the browser.
    console.error('[ai-opinion] unhandled exception', err)
    return new Response(
      JSON.stringify({
        error: 'internal',
        detail: err instanceof Error ? err.message : 'unknown',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
