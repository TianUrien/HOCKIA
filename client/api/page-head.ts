/**
 * Vercel Edge Function: serves a static public route (/opportunities,
 * /community, /world …) with its own head in the initial HTML: title,
 * description, self canonical and og:*, from the same table RouteMeta
 * applies on the client (src/lib/seo/routeMeta.ts). Routed by vercel.json
 * rewrites, one per path. Without this, Google read the shell's generic
 * title for every route.
 *
 * /opportunities and /world also get a body block (open roles; countries)
 * for crawlers that do not run JavaScript; the app replaces it on boot. A
 * failed lookup serves the head alone, as before.
 */
import { renderStaticHtml } from '../src/lib/seo/opportunityHead'
import { ROUTE_META, resolveRouteMeta } from '../src/lib/seo/routeMeta'
import { injectServerBody, opportunitiesBody, worldBody } from '../src/lib/seo/serverBody'
import { fetchOpenRoles, restAnon } from './_publicData'

export const config = { runtime: 'edge' }

const HTML = { 'content-type': 'text/html; charset=utf-8' }
const STATIC_PATHS = new Set(ROUTE_META.map((e) => e.match).filter((m): m is string => typeof m === 'string'))

function siteUrlFor(host: string): string {
  return host === 'inhockia.com' || host === 'www.inhockia.com' ? 'https://inhockia.com' : `https://${host}`
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? url.host
  const origin = `https://${host}`
  const path = url.searchParams.get('path') ?? ''
  if (!STATIC_PATHS.has(path)) return Response.redirect(`${origin}${path.startsWith('/') ? path : '/'}`, 302)

  let shell: string
  try {
    const res = await fetch(`${origin}/app.html`, { headers: { accept: 'text/html' } })
    if (!res.ok) throw new Error(`shell ${res.status}`)
    shell = await res.text()
  } catch {
    return Response.redirect(`${origin}/`, 302)
  }
  let html = renderStaticHtml(shell, path, siteUrlFor(host))
  const intro = resolveRouteMeta(path).description
  if (path === '/opportunities') {
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip')
    const roles = await fetchOpenRoles(clientIp)
    if (roles) html = injectServerBody(html, opportunitiesBody(roles, intro))
  } else if (path === '/world') {
    const rows = await restAnon<{ country_code: string; country_name: string; total_clubs: number | null }>(
      'world_countries_with_directory?select=country_code,country_name,total_clubs&order=country_name.asc',
    )
    if (rows) html = injectServerBody(html, worldBody(rows.map((r) => ({ code: r.country_code, name: r.country_name, totalClubs: r.total_clubs ?? 0 })), intro))
  }
  return new Response(html, {
    status: 200,
    headers: { ...HTML, 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' },
  })
}
