/**
 * Webhook caller authentication for database-webhook edge functions.
 *
 * THE BUG THIS EXISTS TO CLOSE (security review 2026-08-08, proven on prod):
 * `verify_jwt = true` is NOT an authorization boundary. It only proves the
 * caller presented *a* validly-signed Supabase JWT — and the anon key is
 * exactly that, published inside every browser bundle. So every function that
 * relied on the gateway alone was callable by anyone on the internet:
 *
 *   - send-push          → arbitrary OS push notification to any user
 *   - notify-age-gate    → ban any user for 10 years, or UNBAN one (which
 *                          releases frozen minors — a child-safety control)
 *   - notify-vacancy     → mass email to every player/coach, attacker-authored
 *                          HTML, sent from our verified domain
 *   - notify-*           → forged emails naming real members, cross-tenant
 *                          renewal/triage tokens
 *
 * Confirmed by probe: all six returned HTTP 200 to a caller holding nothing
 * but the public anon key, and 401 only when no key was sent at all.
 *
 * THE FIX: Supabase database webhooks call these functions with a
 * **service_role** JWT (verified by reading the live trigger definitions —
 * `supabase_functions.http_request(...)` embeds it in the Authorization
 * header). An attacker cannot mint one: it is signed with the project's JWT
 * secret, which never leaves the server. So requiring `role === 'service_role'`
 * cleanly separates real webhook traffic from forged calls, with no new secret
 * to distribute and no webhook reconfiguration.
 *
 * SAFETY OF DECODING WITHOUT RE-VERIFYING THE SIGNATURE: these functions run
 * with the gateway's `verify_jwt = true` (the platform default; none of them
 * opt out in config.toml). The gateway validates the signature before the
 * function is ever invoked, so any token we see here is authentic — we are
 * only reading a claim from an already-verified token, never trusting an
 * unverified one. `assertServiceRole` still fails closed on anything it cannot
 * parse.
 */

import { corsHeaders } from './cors.ts'

/** Decoded JWT payload — only the claim we care about is typed. */
interface JwtClaims {
  role?: string
}

function decodeClaims(token: string): JwtClaims | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    // base64url → base64, then pad.
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as JwtClaims
  } catch {
    return null
  }
}

/**
 * Returns a 401 Response when the caller is NOT the database webhook
 * (i.e. not service_role), or `null` when the call is legitimate.
 *
 * Usage — first thing inside the handler, after the CORS preflight:
 *
 *   const denied = assertServiceRole(req)
 *   if (denied) return denied
 */
export function assertServiceRole(req: Request): Response | null {
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization')
  const token = header?.replace(/^Bearer\s+/i, '').trim()
  const claims = token ? decodeClaims(token) : null

  if (claims?.role === 'service_role') return null

  // Deliberately terse: never disclose which part failed.
  return new Response(
    JSON.stringify({ error: 'Unauthorized' }),
    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}
