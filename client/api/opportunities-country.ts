/**
 * Vercel Edge Function: serves /opportunities/in/:slug, the open roles of
 * one country (2026-11-20), and answers the old-looking
 * /opportunities/:word URLs that used to return an empty shell.
 *
 * Routed by vercel.json rewrites:
 *   /opportunities/in/:slug → /api/opportunities-country?country=:slug
 *   /opportunities/:word    → /api/opportunities-country?word=:word
 *
 * /opportunities/in/:slug
 *   - a country with open roles: the shell with its own title, description,
 *     canonical, ItemList JSON-LD and the roles as body text
 *   - another spelling or the code (usa, au): 301 to the country's slug
 *   - a country with no open roles now: 302 to /opportunities (temporary,
 *     the page returns when a club posts a role there)
 *   - not a country: 404, noindex
 *   - the roles could not be read: 503, so crawlers retry and keep the page
 * /opportunities/:word (a word, not a role id)
 *   - a country: 301 to /opportunities/in/:slug
 *   - anything else: 404, noindex
 *
 * Browsers with the service worker installed never reach this function
 * (navigateFallback serves app.html from cache); crawlers always do.
 */
import { renderNoindexHtml } from '../src/lib/seo/opportunityHead'
import { countryRolesDescription, countryRolesPath, renderCountryRolesHtml, resolveRoleCountry, rolesInCountry } from '../src/lib/seo/opportunitiesCountry'
import { countryRolesBody, injectServerBody } from '../src/lib/seo/serverBody'
import { fetchOpenRoles, restAnon } from './_publicData'

export const config = { runtime: 'edge' }

const HTML = { 'content-type': 'text/html; charset=utf-8' }

function siteUrlFor(host: string): string {
  return host === 'inhockia.com' || host === 'www.inhockia.com' ? 'https://inhockia.com' : `https://${host}`
}

function redirect(to: string, status: 301 | 302, cache: string): Response {
  return new Response(null, { status, headers: { location: to, 'cache-control': cache } })
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? url.host
  const origin = `https://${host}`
  const word = url.searchParams.get('word')
  const segment = word ?? url.searchParams.get('country') ?? ''
  // A bare word is a country only by name: /opportunities/in must not read as India's code.
  const country = word !== null && word.length <= 2 ? null : resolveRoleCountry(segment)

  if (country && (word !== null || segment.toLowerCase() !== country.slug)) {
    return redirect(`${origin}${countryRolesPath(country)}`, 301, 'public, s-maxage=3600')
  }

  let shell: string
  try {
    const res = await fetch(`${origin}/app.html`, { headers: { accept: 'text/html' } })
    if (!res.ok) throw new Error(`shell ${res.status}`)
    shell = await res.text()
  } catch {
    return Response.redirect(`${origin}/opportunities`, 302)
  }
  const plain = (why: string, status: number, cache: string) =>
    new Response(renderNoindexHtml(shell).replace('</head>', `<!-- opportunities-country: ${why} -->\n</head>`), { status, headers: { ...HTML, 'cache-control': cache } })

  if (!country) return plain('not-a-country', 404, 'public, s-maxage=60')

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip')
  const [open, directory] = await Promise.all([
    fetchOpenRoles(clientIp),
    restAnon<{ country_code: string }>(`world_countries_with_directory?select=country_code&country_code=eq.${country.code}&total_clubs=gt.0&limit=1`),
  ])
  if (open === null) return plain('lookup-failed', 503, 'no-store')

  const roles = rolesInCountry(open, country)
  if (roles.length === 0) return redirect(`${origin}/opportunities`, 302, 'public, s-maxage=60')

  const siteUrl = siteUrlFor(host)
  const body = countryRolesBody(country, roles, countryRolesDescription(country), directory?.[0]?.country_code ?? null)
  const html = injectServerBody(renderCountryRolesHtml(shell, country, roles, siteUrl), body)
  return new Response(html, { status: 200, headers: { ...HTML, 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600' } })
}
