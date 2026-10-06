/**
 * Per-user rate limit through the check_rate_limit RPC (sliding window,
 * advisory-locked). Always call it with the SERVICE client: the RPC is not
 * meant for member sessions.
 *
 *   failMode 'open'   → an RPC error lets the request through (log it).
 *   failMode 'closed' → an RPC error refuses the request.
 */

export interface RateLimitClient {
  // deno-lint-ignore no-explicit-any
  rpc: (fn: any, args?: any) => PromiseLike<{ data: any; error: any }>
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until a slot frees up (only when refused by the limiter). */
  retryAfter: number | null
  /** RPC error message when the limiter itself failed. */
  error: string | null
}

export async function checkUserRateLimit(
  client: RateLimitClient,
  identifier: string,
  action: string,
  maxRequests: number,
  windowSeconds: number,
  failMode: 'open' | 'closed' = 'open',
): Promise<RateLimitResult> {
  try {
    const { data, error } = await client.rpc('check_rate_limit', {
      p_identifier: identifier,
      p_action_type: action,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      return { allowed: failMode === 'open', retryAfter: null, error: error.message ?? String(error) }
    }
    const result = data as { allowed?: boolean; reset_at?: string } | null
    if (result && result.allowed === false) {
      const resetMs = result.reset_at ? new Date(result.reset_at).getTime() : NaN
      const retryAfter = Number.isFinite(resetMs) ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)) : 60
      return { allowed: false, retryAfter, error: null }
    }
    return { allowed: true, retryAfter: null, error: null }
  } catch (err) {
    return { allowed: failMode === 'open', retryAfter: null, error: err instanceof Error ? err.message : String(err) }
  }
}
