/**
 * Vercel Edge Function: serves /opportunities/:id with a per-role head.
 *
 * Routed by the vercel.json rewrite `/opportunities/:id(uuid)` →
 * `/api/opportunity-page?id=:id`. It fetches the SPA shell (app.html) from
 * this deployment and one row of the public_opportunities view, and returns
 * the shell with the role's title, description, canonical, og:* and a
 * JobPosting JSON-LD injected (see src/lib/seo/opportunityHead.ts). The app
 * then boots exactly as before. Roles not in the public view (closed, draft,
 * unknown) get the shell with noindex so Google drops them.
 *
 * Browsers with the service worker installed never reach this function
 * (navigateFallback serves app.html from cache); crawlers always do.
 */
import { renderNoindexHtml, renderOpportunityHtml, type PublicOpportunityRow } from '../src/lib/seo/opportunityHead'

export const config = { runtime: 'edge' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HTML = { 'content-type': 'text/html; charset=utf-8' }

function siteUrlFor(host: string): string {
  return host === 'inhockia.com' || host === 'www.inhockia.com' ? 'https://inhockia.com' : `https://${host}`
}

async function fetchShell(origin: string): Promise<string> {
  const res = await fetch(`${origin}/app.html`, { headers: { accept: 'text/html' } })
  if (!res.ok) throw new Error(`shell ${res.status}`)
  return res.text()
}

async function fetchRole(id: string): Promise<PublicOpportunityRow | null> {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) return null
  const res = await fetch(`${base}/rest/v1/public_opportunities?id=eq.${id}&select=*&limit=1`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  if (!res.ok) return null
  const rows = (await res.json()) as PublicOpportunityRow[]
  return rows[0] ?? null
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? url.host
  const origin = `https://${host}`
  const id = url.searchParams.get('id') ?? ''

  let shell: string
  try {
    shell = await fetchShell(origin)
  } catch {
    // Without the shell there is nothing sensible to serve; let the client
    // retry the plain route (the SPA fallback) rather than show an error.
    return Response.redirect(`${origin}/opportunities`, 302)
  }

  if (!UUID.test(id)) {
    return new Response(renderNoindexHtml(shell), { status: 404, headers: { ...HTML, 'cache-control': 'public, s-maxage=60' } })
  }

  const row = await fetchRole(id).catch(() => null)
  if (!row) {
    // Exists-but-closed and unknown look the same to the public view: both
    // are noindex. Status stays 200 so an owner previewing a draft or a
    // closed role still gets the app.
    return new Response(renderNoindexHtml(shell), { status: 200, headers: { ...HTML, 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  }

  const html = renderOpportunityHtml(shell, row, siteUrlFor(host))
  return new Response(html, { status: 200, headers: { ...HTML, 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600' } })
}
