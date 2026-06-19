/**
 * ga4-funnel — admin-only edge function returning the ANONYMOUS top-of-funnel
 * from the GA4 Data API (landing → CTA → wall shown → wall acted → signup started).
 *
 * Auth: verify_jwt is OFF (per-function config.toml) because we verify the caller
 * in-handler — getUser(token) then the is_platform_admin RPC, mirroring
 * admin-actions. GA4 is read-only and touches no DB tables.
 *
 * Returns one of:
 *   { configured: false, counts: null }                    secrets not set yet
 *   { configured: true, error: '…', counts: null }         GA call failed (retryable)
 *   { configured: true, days, freshnessNote, counts: {…} } success
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
import { isGa4Configured, fetchGa4Funnel, type Ga4FunnelCounts } from './ga4.ts'

const ALLOWED_DAYS = [7, 15, 30, 90]
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // GA4 standard data only finalizes every 24–48h

interface CacheEntry { data: Ga4FunnelCounts; expiresAt: number }
const cache = new Map<number, CacheEntry>()

const createLogger = (correlationId: string) => ({
  info: (m: string, meta?: Record<string, unknown>) =>
    console.log(`[GA4_FUNNEL][${correlationId}] ${m}`, meta ?? ''),
  error: (m: string, meta?: Record<string, unknown>) =>
    console.error(`[GA4_FUNNEL][${correlationId}] ${m}`, meta ?? ''),
})

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger(correlationId)
  const origin = req.headers.get('origin')
  const headers = getCorsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response(null, { headers })

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing authorization header' }, 401)
    const token = authHeader.slice(7)

    // Verify the caller is an authenticated platform admin (verify_jwt is off).
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    )
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) return json({ error: 'Authentication failed' }, 401)
    const { data: isAdmin, error: adminErr } = await userClient.rpc('is_platform_admin')
    if (adminErr || !isAdmin) return json({ error: 'Unauthorized: Admin access required' }, 403)

    // Not-configured sentinel — AFTER the admin gate, so non-admins never see it.
    if (!isGa4Configured()) return json({ configured: false, counts: null })

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const requestedDays = Number(body?.days)
    const days = ALLOWED_DAYS.includes(requestedDays) ? requestedDays : 30

    const cached = cache.get(days)
    if (cached && Date.now() < cached.expiresAt) {
      return json({ configured: true, days, freshnessNote: 'GA4 estimate · lags 24–48h', counts: cached.data })
    }

    try {
      const counts = await fetchGa4Funnel(days)
      cache.set(days, { data: counts, expiresAt: Date.now() + CACHE_TTL_MS })
      return json({ configured: true, days, freshnessNote: 'GA4 estimate · lags 24–48h', counts })
    } catch (err) {
      // Surface GA failures (e.g. 403 PERMISSION_DENIED if the Data API isn't
      // enabled or the SA isn't a property Viewer) as a retryable inline error —
      // NOT a 500 — so the admin card shows Retry instead of crashing Overview.
      logger.error('GA4 fetch failed', { error: err instanceof Error ? err.message : String(err) })
      captureException(err, { functionName: 'ga4-funnel', correlationId })
      return json({ configured: true, error: err instanceof Error ? err.message : 'GA4 request failed', counts: null })
    }
  } catch (err) {
    logger.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) })
    captureException(err, { functionName: 'ga4-funnel', correlationId })
    return json({ error: 'Internal error' }, 500)
  }
})
