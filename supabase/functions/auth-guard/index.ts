// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { clientIp, deviceLabel, parseGuardRequest, verifyTurnstile } from '../_shared/auth-guard.ts'

/**
 * ============================================================================
 * auth-guard — measurement and soft limits in front of sign-in and sign-up
 * ============================================================================
 * The app calls this just before it starts an OAuth sign-in, a password
 * sign-in, a sign-up, a magic link or a password reset, and after a failed
 * password sign-in. Supabase Auth itself is unchanged and still decides.
 *
 * POST JSON:
 *   { action: 'check', kind, provider?, captchaToken?, client: { platform, appVersion, installId } }
 *     -> { allowed: true }
 *     -> { allowed: false, reason: 'rate_limited', retryAfter }
 *     -> { allowed: false, reason: 'captcha_required' | 'captcha_failed' }
 *   { action: 'report', kind: 'password_signin_failed', client }
 *     -> { ok: true }
 *
 * Every attempt is recorded in auth_attempts with the network and the device
 * as keyed hashes (the address and the user agent are hashed in the database
 * and never stored). Refusals happen only when a switch in app_settings is
 * on: auth_rate_limit_enabled, auth_turnstile_enforced. Both default to off.
 *
 * Fails OPEN, unlike age-gate: this sits in front of sign-in, Supabase Auth
 * keeps its own limits behind it, and a database or Cloudflare outage here
 * must never keep a member out.
 *
 * verify_jwt = false (config.toml): callers have no session yet. Installed
 * store builds never call this function, so it cannot refuse them.
 * ============================================================================
 */

function json(status: number, body: Record<string, unknown>, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const cors = getCorsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { allowed: true }, cors)

  try {
    const parsed = parseGuardRequest(await req.json().catch(() => null))
    if (!parsed) return json(200, { allowed: true }, cors)

    const supabase = getServiceClient() as any
    const ip = clientIp(req.headers)
    const userAgent = req.headers.get('user-agent')?.slice(0, 400) ?? null
    const device = {
      p_ip: ip,
      p_user_agent: userAgent,
      p_install_id: parsed.installId,
      p_device_label: deviceLabel(userAgent),
      p_platform: parsed.platform,
      p_app_version: parsed.appVersion,
      p_country: req.headers.get('cf-ipcountry')?.slice(0, 2) ?? null,
    }

    if (parsed.action === 'report') {
      const { error } = await supabase.rpc('auth_guard_report', { p_kind: parsed.kind, ...device })
      if (error) captureException(error, { functionName: 'auth-guard', correlationId })
      return json(200, { ok: true }, cors)
    }

    const captcha = await verifyTurnstile(parsed.captchaToken, Deno.env.get('TURNSTILE_SECRET_KEY'), ip)
    const { data, error } = await supabase.rpc('auth_guard_check', {
      p_kind: parsed.kind,
      p_provider: parsed.provider,
      ...device,
      p_captcha: captcha,
    })
    if (error) {
      captureException(error, { functionName: 'auth-guard', correlationId })
      return json(200, { allowed: true }, cors)
    }
    const result = (data ?? {}) as { allowed?: boolean; reason?: string; retry_after?: number }
    if (result.allowed === false) {
      return json(200, { allowed: false, reason: result.reason ?? 'rate_limited', retryAfter: result.retry_after ?? null }, cors)
    }
    return json(200, { allowed: true }, cors)
  } catch (error) {
    captureException(error, { functionName: 'auth-guard', correlationId })
    return json(200, { allowed: true }, cors)
  }
})
