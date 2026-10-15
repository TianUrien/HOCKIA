/**
 * Vercel Edge Function: serves a static public route (/opportunities,
 * /community, /world …) with its own head in the initial HTML: title,
 * description, self canonical and og:*, from the same table RouteMeta
 * applies on the client (src/lib/seo/routeMeta.ts). Routed by vercel.json
 * rewrites, one per path. Without this, Google read the shell's generic
 * title for every route.
 */
import { renderStaticHtml } from '../src/lib/seo/opportunityHead'
import { ROUTE_META } from '../src/lib/seo/routeMeta'

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
  return new Response(renderStaticHtml(shell, path, siteUrlFor(host)), {
    status: 200,
    headers: { ...HTML, 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' },
  })
}
