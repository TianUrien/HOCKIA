// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  PublicOpportunityRow,
  PublicOpportunitiesResponse,
  PublicOpportunityDetailResponse,
  PublicAPIError,
  PublicOpportunitiesQuery,
  transformToPublicOpportunity,
  validateQueryParams,
  DEFAULT_LIMIT,
  RATE_LIMIT,
} from '../_shared/public-api-types.ts'

/**
 * ============================================================================
 * Public Opportunities API - Edge Function
 * ============================================================================
 *
 * A public, read-only API for AI agents and external consumers to discover
 * field hockey opportunities on HOCKIA.
 *
 * Endpoints:
 *   GET /public-opportunities         - List all open opportunities
 *   GET /public-opportunities/{id}    - Get a single opportunity by ID
 *
 * Query Parameters (for list endpoint):
 *   - position: goalkeeper | defender | midfielder | forward
 *   - gender: Men | Women
 *   - country: Country name (e.g., "Netherlands")
 *   - opportunity_type: player | coach
 *   - priority: high | medium | low
 *   - limit: 1-100 (default: 20)
 *   - offset: 0+ (default: 0)
 *
 * Security:
 *   - No authentication required (public data only)
 *   - Rate limited: 60 req/min, 500 req/hour per IP (database-backed)
 *   - Response caching: 5 minutes
 *   - CORS: Open (*)
 *
 * Data Boundary:
 *   - Only exposes data from the public_opportunities view
 *   - No internal IDs, contact info, or PII
 *   - Only open vacancies from non-test, onboarded clubs
 *
 * ============================================================================
 */

// =============================================================================
// RATE LIMITING (Database-backed via check_rate_limit RPC)
// =============================================================================

interface RateLimitResult {
  allowed: boolean
  remaining: number
  reset_at: string
  limit: number
}

async function checkDbRateLimit(
  supabase: any,
  ip: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    // Per-minute check: 60 req/min
    const { data: minuteCheck, error: minuteError } = await supabase.rpc('check_rate_limit', {
      p_identifier: ip,
      p_action_type: 'public_api',
      p_max_requests: RATE_LIMIT.REQUESTS_PER_MINUTE,
      p_window_seconds: 60,
    })

    if (minuteError) {
      console.error('Rate limit RPC error (minute):', minuteError)
      return { allowed: false, retryAfter: 30 } // fail-closed: block when rate limit backend is degraded
    }

    const minuteResult = minuteCheck as RateLimitResult
    if (!minuteResult.allowed) {
      const resetAt = new Date(minuteResult.reset_at).getTime()
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
      return { allowed: false, retryAfter }
    }

    // Per-hour check: 500 req/hour
    const { data: hourCheck, error: hourError } = await supabase.rpc('check_rate_limit', {
      p_identifier: ip,
      p_action_type: 'public_api_hour',
      p_max_requests: RATE_LIMIT.REQUESTS_PER_HOUR,
      p_window_seconds: 3600,
    })

    if (hourError) {
      console.error('Rate limit RPC error (hour):', hourError)
      return { allowed: false, retryAfter: 30 } // fail-closed: block when rate limit backend is degraded
    }

    const hourResult = hourCheck as RateLimitResult
    if (!hourResult.allowed) {
      const resetAt = new Date(hourResult.reset_at).getTime()
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
      return { allowed: false, retryAfter }
    }

    return { allowed: true }
  } catch (err) {
    console.error('Rate limit check failed:', err)
    return { allowed: false, retryAfter: 30 } // fail-closed: block when rate limit backend is degraded
  }
}

// =============================================================================
// RESPONSE HELPERS
// =============================================================================

function jsonResponse(data: any, status = 200, cacheSeconds = RATE_LIMIT.CACHE_TTL_SECONDS): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  })
}

function errorResponse(code: string, message: string, status: number, details?: string): Response {
  const error: PublicAPIError = {
    error: { code, message, ...(details && { details }) },
  }
  return new Response(JSON.stringify(error), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return errorResponse(
      'METHOD_NOT_ALLOWED',
      'Only GET requests are allowed',
      405
    )
  }

  // Get client IP for rate limiting
  const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || 'unknown'

  // Service role client (shared singleton)
  const supabase = getServiceClient()

  // Check rate limit (database-backed, survives cold starts)
  const rateCheck = await checkDbRateLimit(supabase, clientIP)
  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please slow down.',
          retry_after: rateCheck.retryAfter,
        },
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(rateCheck.retryAfter),
        },
      }
    )
  }

  // Parse URL
  const url = new URL(req.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Extract opportunity ID if present
  // Path: /public-opportunities or /public-opportunities/{id}
  // After Supabase routing, we get just the path after function name
  const opportunityId = pathParts.length > 0 && pathParts[0] !== 'public-opportunities'
    ? pathParts[0]
    : pathParts.length > 1
      ? pathParts[1]
      : null

  try {
    // ==========================================================================
    // GET /public-opportunities/{id} - Single opportunity
    // ==========================================================================
    if (opportunityId) {
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(opportunityId)) {
        return errorResponse(
          'INVALID_ID',
          'Invalid opportunity ID format',
          400
        )
      }

      const { data, error } = await supabase
        .from('public_opportunities')
        .select('*')
        .eq('id', opportunityId)
        .single()

      if (error || !data) {
        return errorResponse(
          'NOT_FOUND',
          'Opportunity not found',
          404
        )
      }

      const response: PublicOpportunityDetailResponse = {
        data: transformToPublicOpportunity(data as PublicOpportunityRow),
      }

      return jsonResponse(response)
    }

    // ==========================================================================
    // GET /public-opportunities - List opportunities
    // ==========================================================================
    
    // Validate query parameters
    const validation = validateQueryParams(url.searchParams)
    if (!validation.valid) {
      return errorResponse(
        'INVALID_PARAMETER',
        validation.error || 'Invalid query parameter',
        400
      )
    }

    const query: PublicOpportunitiesQuery = validation.query

    // Build query
    let dbQuery = supabase
      .from('public_opportunities')
      .select('*', { count: 'exact' })

    // Apply filters
    if (query.position) {
      dbQuery = dbQuery.eq('position', query.position)
    }
    if (query.gender) {
      dbQuery = dbQuery.eq('gender', query.gender)
    }
    if (query.country) {
      dbQuery = dbQuery.ilike('location_country', query.country)
    }
    if (query.opportunity_type) {
      dbQuery = dbQuery.eq('opportunity_type', query.opportunity_type)
    }
    if (query.priority) {
      dbQuery = dbQuery.eq('priority', query.priority)
    }

    // Apply pagination and ordering
    const limit = query.limit || DEFAULT_LIMIT
    const offset = query.offset || 0

    dbQuery = dbQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await dbQuery

    if (error) {
      console.error('Database error:', error)
      return errorResponse(
        'DATABASE_ERROR',
        'Failed to fetch opportunities',
        500
      )
    }

    const total = count || 0
    const opportunities = (data as PublicOpportunityRow[]).map(transformToPublicOpportunity)

    const response: PublicOpportunitiesResponse = {
      data: opportunities,
      meta: {
        total,
        limit,
        offset,
        has_more: offset + opportunities.length < total,
      },
    }

    return jsonResponse(response)

  } catch (err) {
    console.error('Unexpected error:', err)
    captureException(err, { functionName: 'public-opportunities' })
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred',
      500
    )
  }
})
