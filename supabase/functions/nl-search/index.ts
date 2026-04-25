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
import { parseSearchQuery, synthesizeQualitativeInsights, PROMPT_VERSION, type LLMCallMeta, type ParsedFilters, type HistoryTurn, type ProfileQualitativeData, type UserContext } from '../_shared/llm-client.ts'

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
}): Promise<Response> {
  const { adminClient, rawQuery, userId, userRole, startTime, llmProvider, originalError, parseRetryCount, headers, correlationId } = params

  try {
    const discoverableRoles = ['player', 'coach', 'club', 'brand']
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('discover_profiles', {
      p_roles: discoverableRoles,
      p_search_text: rawQuery,
      p_sort_by: 'relevance',
      p_limit: 20,
      p_offset: 0,
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

    return new Response(
      JSON.stringify({
        success: true,
        data: result.results,
        total: result.total,
        has_more: result.has_more,
        parsed_filters: null,
        summary: `Showing ${result.total} keyword match${result.total === 1 ? '' : 'es'}.`,
        ai_message: 'AI assistant is temporarily unavailable. Showing keyword matches instead.',
      }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  } catch (fallbackError) {
    captureException(fallbackError, { functionName: 'nl-search', correlationId, extra: { phase: 'fallback' } })
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
      error_message: `${originalError.message} | fallback: ${fallbackError instanceof Error ? fallbackError.message : 'unknown'}`,
      prompt_tokens: null,
      completion_tokens: null,
      cached_tokens: null,
      prompt_version: PROMPT_VERSION,
      fallback_used: true,
      retry_count: parseRetryCount,
    }))
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Search is temporarily unavailable. Please try again in a moment.',
      }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
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
    const rawHistory = Array.isArray(body?.history) ? body.history : []
    const history: HistoryTurn[] = rawHistory
      .slice(-10)
      .filter((t: any) => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.content === 'string')

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

    // ── Fetch user context for LLM ─────────────────────────────────────
    let userContext: UserContext | undefined

    try {
      const { data: userProfile } = await adminClient
        .from('profiles')
        .select(`
          role, full_name, gender, position,
          base_city, base_country_id,
          nationality_country_id, nationality2_country_id,
          current_club, current_world_club_id,
          eu_passport, open_to_play, open_to_coach
        `)
        .eq('id', user.id)
        .single()

      if (userProfile) {
        const countryIds = [
          userProfile.base_country_id,
          userProfile.nationality_country_id,
          userProfile.nationality2_country_id,
        ].filter(Boolean)

        const [countriesRes, clubRes] = await Promise.all([
          countryIds.length > 0
            ? adminClient.from('countries').select('id, name').in('id', countryIds)
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
        ])

        const countryMap = new Map(
          ((countriesRes.data || []) as any[]).map((c: any) => [c.id, c.name])
        )

        const club = clubRes.data as any
        let currentLeague: string | null = null
        let leagueCountry: string | null = null
        if (club) {
          currentLeague = userProfile.gender === 'Women'
            ? club.women_league?.name || null
            : club.men_league?.name || null
          leagueCountry = club.country?.name || null
        }

        userContext = {
          role: userProfile.role,
          full_name: userProfile.full_name,
          gender: userProfile.gender,
          position: userProfile.position,
          base_city: userProfile.base_city,
          base_country_name: countryMap.get(userProfile.base_country_id) || null,
          nationality_name: countryMap.get(userProfile.nationality_country_id) || null,
          nationality2_name: countryMap.get(userProfile.nationality2_country_id) || null,
          current_club: club?.club_name || userProfile.current_club || null,
          current_league: currentLeague,
          league_country: leagueCountry,
          eu_passport: userProfile.eu_passport || false,
          open_to_play: userProfile.open_to_play || false,
          open_to_coach: userProfile.open_to_coach || false,
        }
      }
    } catch (ctxError) {
      // Non-fatal: AI works generically without user context
      captureException(ctxError, { functionName: 'nl-search', correlationId, note: 'user-context-fetch' })
    }

    pendingUserRole = userContext?.role ?? null

    // ── LLM parsing ─────────────────────────────────────────────────────
    const { result: llmResult, meta: parseMeta } = await parseSearchQuery(query, history, userContext)

    // ── Conversation or knowledge response (no search needed) ────────
    if (llmResult.type === 'conversation' || llmResult.type === 'knowledge') {
      fireAndForget(logDiscoveryEvent(adminClient, {
        user_id: user.id,
        role: userContext?.role ?? null,
        query_text: query,
        intent: llmResult.type,
        parsed_filters: null,
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

    // ── Call discover_profiles RPC ──────────────────────────────────────
    // Umpires are a credential-only role and should not surface in default
    // player/coach/club/brand searches. When the LLM doesn't specify roles,
    // default to the four discoverable roles rather than NULL (which the RPC
    // treats as "all roles" and would include umpires).
    const discoverableRoles = ['player', 'coach', 'club', 'brand']
    const effectiveRoles = parsed.roles && parsed.roles.length > 0
      ? parsed.roles
      : discoverableRoles
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('discover_profiles', {
      p_roles: effectiveRoles,
      p_positions: parsed.positions || null,
      p_gender: parsed.gender || null,
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
      p_limit: 20,
      p_offset: 0,
    })

    if (rpcError) {
      captureException(rpcError, { functionName: 'nl-search', correlationId })
      return new Response(
        JSON.stringify({ success: false, error: 'Search query failed' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const result = rpcResult as { results: any[]; total: number; has_more: boolean }

    // ── Result-aware AI message ──────────────────────────────────────
    let aiMessage: string
    if (result.total === 0) {
      aiMessage = `I couldn't find any profiles matching that. Try broadening your search or adjusting your filters.`
    } else {
      const countPhrase = `I found ${result.total} profile${result.total === 1 ? '' : 's'} for you.`
      aiMessage = llmResult.message ? `${countPhrase} ${llmResult.message}` : countPhrase
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

    // ── Analytics logging ────────────────────────────────────────────────
    fireAndForget(logDiscoveryEvent(adminClient, {
      user_id: user.id,
      role: userContext?.role ?? null,
      query_text: query,
      intent: 'search',
      parsed_filters: parsed,
      result_count: result.total,
      has_qualitative: llmResult.include_qualitative === true && result.results.length > 0,
      llm_provider: llmProvider,
      response_time_ms: Date.now() - startTime,
      error_message: null,
      prompt_tokens: sumNullable(parseMeta.usage?.prompt_tokens ?? null, synthMeta?.usage?.prompt_tokens ?? null),
      completion_tokens: sumNullable(parseMeta.usage?.completion_tokens ?? null, synthMeta?.usage?.completion_tokens ?? null),
      cached_tokens: sumNullable(parseMeta.usage?.cached_tokens ?? null, synthMeta?.usage?.cached_tokens ?? null),
      prompt_version: PROMPT_VERSION,
      fallback_used: false,
      retry_count: parseMeta.retry_count + (synthMeta?.retry_count ?? 0),
    }))

    // ── Response ────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        data: result.results,
        total: result.total,
        has_more: result.has_more,
        parsed_filters: parsed,
        summary: parsed.summary || `Found ${result.total} result${result.total === 1 ? '' : 's'}.`,
        ai_message: aiMessage,
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
      })
    }

    // Failed before the query was validated — nothing to fall back to.
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }
})
