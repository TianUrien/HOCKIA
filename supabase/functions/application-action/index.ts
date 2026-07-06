// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { hashToken } from '../_shared/action-tokens.ts'

/**
 * ============================================================================
 * application-action — JSON API behind the digest email's one-click triage
 * ============================================================================
 *
 * The email buttons link to the APP (`/email-action?t=…`, a public SPA route)
 * which calls this function. The function itself never returns HTML: the
 * Supabase gateway forces `Content-Type: text/plain` + a sandbox CSP onto
 * HTML responses served from the shared *.supabase.co functions domain
 * (anti-phishing), so pages must render on the app domain.
 *
 * Security model:
 *   - capability URL: unguessable 32-byte token, stored hashed, single-use,
 *     expiring; every transition preconditioned on status='pending' inside
 *     the atomic apply_email_action() RPC (a stale link can never overwrite
 *     in-app triage or the expiry sweep).
 *   - GET is a read-only PEEK (never mutates): the SPA uses it to decide
 *     whether to show the rejection confirm step or auto-execute. Mail
 *     scanners that prefetch the app URL therefore change nothing; execution
 *     requires the SPA's JS to POST.
 *   - POST executes. IP rate-limited fail-closed via check_rate_limit.
 *   - verify_jwt=false (recipients click from their inbox, logged out);
 *     CORS restricted to the app origins via getCorsHeaders.
 * ============================================================================
 */

const RATE_LIMIT_PER_MIN = 60

type Action = 'shortlisted' | 'maybe' | 'rejected' | 'renew'

interface ActionInfo {
  outcome: string
  action?: Action
  applicant_name?: string
  opportunity_id?: string
  opportunity_title?: string
  new_deadline?: string
}

function json(status: number, body: ActionInfo, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function rateLimited(supabase: any, req: Request): Promise<boolean> {
  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim())
    || req.headers.get('cf-connecting-ip')
    || 'unknown'
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_identifier: ip,
      p_action_type: 'email_action',
      p_max_requests: RATE_LIMIT_PER_MIN,
      p_window_seconds: 60,
    })
    if (error) return true // fail-closed: this endpoint mutates state
    return !(data as any)?.allowed
  } catch {
    return true
  }
}

function extractToken(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.trim()
  // 32 random bytes, base64url, unpadded → exactly 43 chars.
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const cors = getCorsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return json(405, { outcome: 'invalid' }, cors)
    }

    const url = new URL(req.url)
    const supabase = getServiceClient()

    if (await rateLimited(supabase, req)) {
      return json(429, { outcome: 'rate_limited' }, cors)
    }

    let rawToken: string | null = null
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      rawToken = extractToken(body?.t)
    } else {
      rawToken = extractToken(url.searchParams.get('t'))
    }
    if (!rawToken) return json(200, { outcome: 'invalid' }, cors)

    const tokenHash = await hashToken(rawToken)

    if (req.method === 'POST') {
      // ── Execute (atomic: validate + mutation + token burn in one RPC).
      //    Triage tokens act on an application, renew tokens on an
      //    opportunity — the token's action picks the RPC. ──
      const { data: tok } = await supabase
        .from('email_action_tokens')
        .select('action')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      const rpc = (tok as any)?.action === 'renew' ? 'apply_renewal_action' : 'apply_email_action'
      const { data, error } = await supabase.rpc(rpc, { p_token_hash: tokenHash })
      if (error) {
        captureException(error, { functionName: 'application-action', correlationId })
        return json(500, { outcome: 'error' }, cors)
      }
      return json(200, (data ?? { outcome: 'invalid' }) as unknown as ActionInfo, cors)
    }

    // ── GET: read-only peek — the SPA decides what to render ──
    const { data: token, error: peekError } = await supabase
      .from('email_action_tokens')
      .select(`
        action, used_at, expires_at,
        application:opportunity_applications (
          id, status, opportunity_id,
          opportunity:opportunities (id, title),
          applicant:profiles (full_name)
        ),
        opportunity:opportunities (id, title)
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (peekError) {
      captureException(peekError, { functionName: 'application-action', correlationId })
      return json(500, { outcome: 'error' }, cors)
    }
    if (!token) return json(200, { outcome: 'invalid' }, cors)

    const action = (token as any).action as Action
    let info: ActionInfo

    if (action === 'renew') {
      const opp = (token as any).opportunity
      if (!opp) return json(200, { outcome: 'invalid' }, cors)
      info = {
        outcome: 'ready',
        action,
        opportunity_id: opp.id,
        opportunity_title: opp.title ?? undefined,
      }
      if ((token as any).used_at) return json(200, { ...info, outcome: 'used' }, cors)
      if (new Date((token as any).expires_at).getTime() < Date.now()) {
        return json(200, { ...info, outcome: 'expired' }, cors)
      }
      // No status precondition on the peek: the SPA auto-executes renew and
      // the RPC decides (renewed / closed_by_publisher / …) atomically.
      return json(200, info, cors)
    }

    const app = (token as any).application
    if (!app) return json(200, { outcome: 'invalid' }, cors)

    info = {
      outcome: 'ready',
      action,
      applicant_name: app.applicant?.full_name ?? undefined,
      opportunity_id: app.opportunity_id,
      opportunity_title: app.opportunity?.title ?? undefined,
    }

    if ((token as any).used_at) return json(200, { ...info, outcome: 'used' }, cors)
    if (new Date((token as any).expires_at).getTime() < Date.now()) {
      return json(200, { ...info, outcome: 'expired' }, cors)
    }
    if (app.status !== 'pending') return json(200, { ...info, outcome: 'already_handled' }, cors)

    return json(200, info, cors)
  } catch (error) {
    captureException(error, { functionName: 'application-action', correlationId })
    return json(500, { outcome: 'error' }, getCorsHeaders(req.headers.get('origin')))
  }
})
