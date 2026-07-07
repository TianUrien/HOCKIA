// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * ============================================================================
 * age-gate — anon-facing endpoints for the 18+ policy (P3)
 * ============================================================================
 * Actions (POST JSON):
 *   { action: 'waitlist', email, dob? } — juniors_waitlist capture. Called
 *     from the blocked-signup screen (no account exists, so the caller is
 *     anon) and from the goodbye email's logged-out waitlist link. Idempotent
 *     on email (lower-cased unique index). IP rate-limited fail-closed.
 *
 * verify_jwt=false (config.toml): blocked minors have no session by design.
 * The service client writes to the (service-role-only) waitlist table.
 * ============================================================================
 */

const RATE_LIMIT_PER_MIN = 10
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/

function json(status: number, body: Record<string, unknown>, headers: Record<string, string>): Response {
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
      p_action_type: 'age_gate',
      p_max_requests: RATE_LIMIT_PER_MIN,
      p_window_seconds: 60,
    })
    if (error) return true // fail-closed: anon-facing write endpoint
    return !(data as any)?.allowed
  } catch {
    return true
  }
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const cors = getCorsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    if (req.method !== 'POST') {
      return json(405, { outcome: 'invalid' }, cors)
    }

    const supabase = getServiceClient()
    if (await rateLimited(supabase, req)) {
      return json(429, { outcome: 'rate_limited' }, cors)
    }

    const body = await req.json().catch(() => ({}))

    if (body?.action === 'waitlist') {
      const email = String(body?.email ?? '').trim().toLowerCase()
      const dob = typeof body?.dob === 'string' && DOB_RE.test(body.dob) ? body.dob : null
      if (!EMAIL_RE.test(email) || email.length > 254) {
        return json(200, { outcome: 'invalid_email' }, cors)
      }
      // Plain insert + duplicate tolerance: the unique index is on
      // lower(email) (expression index — PostgREST upsert can't target it);
      // email is already lower-cased above, so a rerun is a no-op.
      const { error } = await supabase
        .from('juniors_waitlist')
        .insert({ email, date_of_birth: dob, source: 'signup_gate' } as any)
      if (error && !/duplicate|unique/i.test(error.message)) {
        captureException(error, { functionName: 'age-gate', correlationId })
        return json(500, { outcome: 'error' }, cors)
      }
      return json(200, { outcome: 'saved' }, cors)
    }

    return json(200, { outcome: 'invalid' }, cors)
  } catch (error) {
    captureException(error, { functionName: 'age-gate', correlationId })
    return json(500, { outcome: 'error' }, getCorsHeaders(req.headers.get('origin')))
  }
})
