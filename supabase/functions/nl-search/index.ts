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
import { parseSearchQuery, synthesizeQualitativeInsights, LLMRateLimitError, type ParsedFilters, type LLMResult, type HistoryTurn, type ProfileQualitativeData, type UserContext } from '../_shared/llm-client.ts'

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const origin = req.headers.get('origin')
  const headers = getCorsHeaders(origin)

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

    // ── LLM parsing ─────────────────────────────────────────────────────
    const llmResult: LLMResult = await parseSearchQuery(query, history, userContext)

    // ── Conversation or knowledge response (no search needed) ────────
    if (llmResult.type === 'conversation' || llmResult.type === 'knowledge') {
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
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('discover_profiles', {
      p_roles: parsed.roles || null,
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
            const synthesis = await synthesizeQualitativeInsights(qualData, query)
            if (synthesis) aiMessage += `\n\n${synthesis}`
          }
        }
      } catch (qualError) {
        // Rate limit errors should propagate to the outer handler for a clean 429
        if (qualError instanceof LLMRateLimitError) throw qualError
        // Non-fatal: log but don't fail the search
        captureException(qualError, { functionName: 'nl-search', correlationId })
      }
    }

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
    if (error instanceof LLMRateLimitError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'The AI assistant has reached its usage limit for now. Please try again in a few minutes.',
        }),
        { status: 429, headers: { ...headers, 'Retry-After': '60', 'Content-Type': 'application/json' } }
      )
    }

    captureException(error, { functionName: 'nl-search', correlationId })
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }
})
