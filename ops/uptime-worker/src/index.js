/**
 * HOCKIA uptime + synthetic monitor (Cloudflare Worker, cron triggers).
 *
 * Replaces the GitHub Actions "Uptime Monitor" (every 5 min) and the HTTP
 * part of "Synthetic Monitoring" (every 6 h), so monitoring costs no Actions
 * minutes. The browser (Playwright) smoke run stays on GitHub as a manual
 * workflow.
 *
 *   every 5 min  → production health endpoint + warm the critical edge functions
 *   every 6 h    → key pages and public functions answer as expected
 *
 * Alerts: one email when a check starts failing, one when it recovers; no
 * repeats in between (state lives in KV). Secrets: RESEND_API_KEY, ALERT_TO.
 */

const WARM_FUNCTIONS = ['nl-search', 'notify-vacancy', 'notify-application', 'send-push', 'delete-account', 'public-opportunities']

async function timedFetch(url, init = {}, ms = 30000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

/** Each check returns null when healthy, or a short failure reason. */
async function checkHealth(env) {
  try {
    const res = await timedFetch(`${env.SUPABASE_URL}/functions/v1/health`, {
      headers: { Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
    })
    if (res.status !== 200) return `health endpoint returned HTTP ${res.status}`
    return null
  } catch (err) {
    return `health endpoint unreachable (${err.name === 'AbortError' ? 'timeout' : err.message})`
  }
}

async function warmFunctions(env) {
  await Promise.allSettled(WARM_FUNCTIONS.map((fn) =>
    timedFetch(`${env.SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://inhockia.com', 'Access-Control-Request-Method': 'POST' },
    }, 10000)))
}

const SYNTHETIC_CHECKS = [
  { name: 'Home page', url: (env) => `${env.SITE_URL}/`, expect: (res, body) => res.status === 200 && body.includes('id="root"') },
  { name: 'Opportunities page', url: (env) => `${env.SITE_URL}/opportunities`, expect: (res) => res.status === 200 },
  { name: 'Public opportunities API', url: (env) => `${env.SUPABASE_URL}/functions/v1/public-opportunities`, auth: true, expect: (res) => res.status === 200 },
  { name: 'Sitemap', url: (env) => `${env.SUPABASE_URL}/functions/v1/sitemap`, auth: true, expect: (res, body) => res.status === 200 && body.includes('<urlset') },
]

async function runSynthetic(env) {
  const results = {}
  for (const c of SYNTHETIC_CHECKS) {
    try {
      const headers = { 'User-Agent': 'HOCKIA-Monitor/1.0' }
      if (c.auth) headers.Authorization = `Bearer ${env.SUPABASE_ANON_KEY}`
      const res = await timedFetch(c.url(env), { headers })
      const body = await res.text()
      results[c.name] = c.expect(res, body) ? null : `HTTP ${res.status}, unexpected response`
    } catch (err) {
      results[c.name] = `unreachable (${err.name === 'AbortError' ? 'timeout' : err.message})`
    }
  }
  return results
}

async function sendEmail(env, subject, text) {
  if (!env.RESEND_API_KEY || !env.ALERT_TO) return
  await timedFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.ALERT_FROM, to: env.ALERT_TO.split(',').map((s) => s.trim()), subject, text }),
  }, 15000)
}

/** Record a check result; email only on a change between healthy and failing. */
async function track(env, key, label, failure) {
  const prev = await env.STATE.get(key, 'json')
  const now = new Date().toISOString()
  if (failure && (!prev || prev.ok)) {
    await env.STATE.put(key, JSON.stringify({ ok: false, since: now, reason: failure }))
    await sendEmail(env, `[HOCKIA] DOWN: ${label}`, `${label} is failing since ${now}.\n\nReason: ${failure}\n\nYou will get one more email when it recovers.`)
  } else if (!failure && prev && !prev.ok) {
    await env.STATE.put(key, JSON.stringify({ ok: true, since: now }))
    await sendEmail(env, `[HOCKIA] RECOVERED: ${label}`, `${label} is healthy again (${now}).\n\nIt was failing since ${prev.since}: ${prev.reason}`)
  } else if (!prev) {
    await env.STATE.put(key, JSON.stringify({ ok: !failure, since: now }))
  }
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '*/5 * * * *') {
      const failure = await checkHealth(env)
      await track(env, 'health', 'Production health check', failure)
      if (!failure) ctx.waitUntil(warmFunctions(env))
      await env.STATE.put('last_run:health', new Date().toISOString())
    } else {
      const results = await runSynthetic(env)
      for (const [name, failure] of Object.entries(results)) {
        await track(env, `synthetic:${name}`, name, failure)
      }
      await env.STATE.put('last_run:synthetic', new Date().toISOString())
    }
  },

  /** GET /status: last run times and current state (no secrets). */
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/status') return new Response('Not found', { status: 404 })
    const keys = ['health', 'last_run:health', 'last_run:synthetic', ...SYNTHETIC_CHECKS.map((c) => `synthetic:${c.name}`)]
    const out = {}
    for (const k of keys) out[k] = await env.STATE.get(k, 'json').catch(() => null) ?? await env.STATE.get(k)
    return Response.json(out)
  },
}
