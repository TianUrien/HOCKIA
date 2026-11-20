/**
 * Vercel Edge Function: serves /world/:code and /world/clubs/:id with a
 * field hockey head in the initial HTML (SEO, 2026-11-10).
 *
 * Routed by vercel.json rewrites:
 *   /world/clubs/:id(uuid) → /api/world-page?club=:id
 *   /world/:slug           → /api/world-page?country=:slug
 * It fetches the SPA shell (app.html) from this deployment and the public
 * directory rows (world_countries_with_directory, world_clubs, countries,
 * world_provinces, world_leagues — all readable by anon, no profiles), and
 * returns the shell with the head from src/lib/seo/worldHead.ts. The app
 * then boots exactly as before. Each page also carries a body block for
 * crawlers that do not run JavaScript (clubs, leagues, regions; a club's
 * place, leagues and open roles), which the app replaces on boot.
 *
 * - A country name slug (/world/argentina) gets a 301 to its ISO-2 URL,
 *   the canonical form the app already uses.
 * - A real country not curated in the directory, an unknown slug and an
 *   unknown club get the shell with noindex (status 200 so the app still
 *   renders its own empty state).
 *
 * Browsers with the service worker installed never reach this function
 * (navigateFallback serves app.html from cache); crawlers always do.
 */
import { renderNoindexHtml } from '../src/lib/seo/opportunityHead'
import { clubDescription, countryDescription, renderClubHtml, renderCountryHtml, type WorldClubHead, type WorldCountryHead } from '../src/lib/seo/worldHead'
import { clubBody, countryBody, injectServerBody, rolesForClub } from '../src/lib/seo/serverBody'
import { countriesWithRoles } from '../src/lib/seo/opportunitiesCountry'
import { fetchOpenRoles } from './_publicData'

export const config = { runtime: 'edge' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HTML = { 'content-type': 'text/html; charset=utf-8' }
/** Clubs listed in the country page's ItemList. */
const ITEM_LIST_MAX = 50

function siteUrlFor(host: string): string {
  return host === 'inhockia.com' || host === 'www.inhockia.com' ? 'https://inhockia.com' : `https://${host}`
}

async function fetchShell(origin: string): Promise<string> {
  const res = await fetch(`${origin}/app.html`, { headers: { accept: 'text/html' } })
  if (!res.ok) throw new Error(`shell ${res.status}`)
  return res.text()
}

/** One PostgREST read with the anon key; null on any failure. */
async function rest<T>(query: string): Promise<T[] | null> {
  const base = (process.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const key = (process.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!base || !key) return null
  try {
    const res = await fetch(`${base}/rest/v1/${query}`, { headers: { apikey: key, accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T[]
  } catch (err) {
    console.error('[world-page] lookup failed', err instanceof Error ? err.message : String(err))
    return null
  }
}

type Outcome = { kind: 'html'; html: string } | { kind: 'redirect'; to: string } | { kind: 'noindex'; why: string }

async function country(slugRaw: string, shell: string, siteUrl: string, clientIp: string | null): Promise<Outcome> {
  const slug = slugRaw.trim().toLowerCase()
  if (!/^[a-z][a-z-]{1,60}$/.test(slug)) return { kind: 'noindex', why: 'bad-slug' }

  // Codes first: ISO-2 (ar) and the home nations (gb-eng, gb-sct, gb-nir).
  const looksLikeCode = /^[a-z]{2}(-[a-z]{2,3})?$/.test(slug)
  const dir = looksLikeCode
    ? await rest<{ country_id: number; country_code: string; country_name: string; total_clubs: number | null; total_leagues: number | null }>(
      `world_countries_with_directory?select=country_id,country_code,country_name,total_clubs,total_leagues&country_code=eq.${slug.toUpperCase()}&limit=1`,
    )
    : []
  if (dir === null) return { kind: 'noindex', why: 'lookup-failed' }
  const row = dir[0]
  if (!row) {
    // Not a code in the directory: maybe a country name (/world/argentina).
    if (slug.length > 2) {
      const named = await rest<{ code: string }>(`countries?select=code&name=ilike.${encodeURIComponent(slug.replace(/-/g, ' '))}&limit=1`)
      if (named?.[0]?.code) return { kind: 'redirect', to: `/world/${named[0].code.toLowerCase()}` }
    }
    return { kind: 'noindex', why: looksLikeCode ? 'not-in-directory' : 'unknown-name' }
  }

  const clubs = await rest<{ id: string; club_name: string }>(
    `world_clubs?select=id,club_name&country_id=eq.${row.country_id}&order=is_claimed.desc,club_name.asc&limit=${ITEM_LIST_MAX}`,
  )
  // Leagues hang off the country (national) or one of its regions.
  const provinces = await rest<{ id: number; name: string; slug: string }>(
    `world_provinces?select=id,name,slug&country_id=eq.${row.country_id}&order=display_order.asc,name.asc&limit=60`,
  )
  const provinceIds = (provinces ?? []).map((p) => p.id)
  const leagueFilter = provinceIds.length > 0
    ? `or=(country_id.eq.${row.country_id},province_id.in.(${provinceIds.join(',')}))`
    : `country_id=eq.${row.country_id}`
  const [leagues, openRoles] = await Promise.all([
    rest<{ name: string }>(`world_leagues?select=name&${leagueFilter}&order=tier.asc.nullslast,display_order.asc&limit=60`),
    fetchOpenRoles(clientIp),
  ])
  // Link the country's open-roles page only while it has open roles.
  const rolesCountry = countriesWithRoles(openRoles ?? []).find((rc) => rc.code === row.country_code.toUpperCase()) ?? null
  const head: WorldCountryHead = {
    code: row.country_code,
    name: row.country_name,
    totalClubs: row.total_clubs ?? 0,
    totalLeagues: row.total_leagues ?? 0,
    clubs: (clubs ?? []).map((c) => ({ id: c.id, name: c.club_name })),
  }
  const body = countryBody(head, { leagues: [...new Set((leagues ?? []).map((l) => l.name))], provinces: (provinces ?? []).map((p) => ({ name: p.name, slug: p.slug })), openRoles: rolesCountry }, countryDescription(head))
  return { kind: 'html', html: injectServerBody(renderCountryHtml(shell, head, siteUrl), body) }
}

async function club(id: string, shell: string, siteUrl: string, clientIp: string | null): Promise<Outcome> {
  if (!UUID.test(id)) return { kind: 'noindex', why: 'bad-id' }
  const rows = await rest<{
    id: string; club_name: string; avatar_url: string | null; is_claimed: boolean | null
    country_id: number | null; province_id: number | null; men_league_id: number | null; women_league_id: number | null
  }>(`world_clubs?select=id,club_name,avatar_url,is_claimed,country_id,province_id,men_league_id,women_league_id&id=eq.${id}&limit=1`)
  if (rows === null) return { kind: 'noindex', why: 'lookup-failed' }
  const c = rows[0]
  if (!c) return { kind: 'noindex', why: 'unknown-club' }

  const leagueIds = [c.men_league_id, c.women_league_id].filter((v): v is number => typeof v === 'number')
  const [openRoles, countryRows, provinceRows, leagueRows] = await Promise.all([
    fetchOpenRoles(clientIp),
    c.country_id ? rest<{ code: string; name: string }>(`countries?select=code,name&id=eq.${c.country_id}&limit=1`) : Promise.resolve(null),
    c.province_id ? rest<{ name: string }>(`world_provinces?select=name&id=eq.${c.province_id}&limit=1`) : Promise.resolve(null),
    leagueIds.length ? rest<{ id: number; name: string }>(`world_leagues?select=id,name&id=in.(${leagueIds.join(',')})`) : Promise.resolve(null),
  ])
  const leagueName = (lid: number | null) => (lid === null ? null : leagueRows?.find((l) => l.id === lid)?.name ?? null)
  const head: WorldClubHead = {
    id: c.id,
    name: c.club_name,
    avatarUrl: c.avatar_url,
    isClaimed: Boolean(c.is_claimed),
    country: countryRows?.[0] ?? null,
    province: provinceRows?.[0]?.name ?? null,
    menLeague: leagueName(c.men_league_id),
    womenLeague: leagueName(c.women_league_id),
  }
  const body = clubBody(head, rolesForClub(openRoles ?? [], head), clubDescription(head))
  return { kind: 'html', html: injectServerBody(renderClubHtml(shell, head, siteUrl), body) }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? url.host
  const origin = `https://${host}`
  const clubId = url.searchParams.get('club')
  const countrySlug = url.searchParams.get('country')

  let shell: string
  try {
    shell = await fetchShell(origin)
  } catch {
    return Response.redirect(`${origin}/world`, 302)
  }

  const siteUrl = siteUrlFor(host)
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip')
  const outcome = clubId !== null ? await club(clubId, shell, siteUrl, clientIp) : await country(countrySlug ?? '', shell, siteUrl, clientIp)

  if (outcome.kind === 'redirect') {
    return new Response(null, { status: 301, headers: { location: `${origin}${outcome.to}`, 'cache-control': 'public, s-maxage=3600' } })
  }
  if (outcome.kind === 'noindex') {
    const html = renderNoindexHtml(shell).replace('</head>', `<!-- world-page: ${outcome.why} -->\n</head>`)
    return new Response(html, { status: 200, headers: { ...HTML, 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  }
  return new Response(outcome.html, { status: 200, headers: { ...HTML, 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } })
}
