/**
 * Server-side head for the world directory: /world/:code and
 * /world/clubs/:id (SEO, 2026-11-10).
 *
 * Search Console shows people searching for clubs by name ("united hockey
 * club canberra", "hockey clubs cape town", "lazio hockey") and landing on
 * these pages, but the pages were served with the shell's generic title and
 * description, so Google read 60+ near-identical pages. The Vercel edge
 * function api/world-page.ts reads the public directory tables and uses
 * these pure helpers to inject a field hockey title, description, canonical,
 * og:* and JSON-LD into the initial HTML. The app then boots as before.
 *
 * No DOM, no imports from the app beyond ./opportunityHead (bundled into the
 * edge function with relative imports).
 */
import { escapeHtml, jsonForScript, setMeta } from './opportunityHead'

export interface WorldCountryHead {
  code: string
  name: string
  totalClubs: number
  totalLeagues: number
  /** Club names and ids for the ItemList, best first; capped by the caller. */
  clubs: { id: string; name: string }[]
}

export interface WorldClubHead {
  id: string
  name: string
  avatarUrl: string | null
  isClaimed: boolean
  country: { code: string; name: string } | null
  province: string | null
  menLeague: string | null
  womenLeague: string | null
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function countryTitle(c: WorldCountryHead): string {
  return `Field Hockey Clubs in ${clean(c.name)} – Leagues & Clubs | Hockia`
}

export function countryDescription(c: WorldCountryHead): string {
  const name = clean(c.name)
  const counts = c.totalClubs > 0
    ? `${plural(c.totalClubs, 'field hockey club', 'field hockey clubs')}${c.totalLeagues > 0 ? ` and ${plural(c.totalLeagues, 'league', 'leagues')}` : ''} in ${name}`
    : `Field hockey clubs and leagues in ${name}`
  return `${counts}: men's and women's divisions, club pages and open roles for players and coaches. Find your next field hockey club on Hockia.`
}

export function clubTitle(c: WorldClubHead): string {
  const where = c.country ? ` in ${clean(c.country.name)}` : ''
  return `${clean(c.name)} – Field Hockey Club${where} | Hockia`
}

export function clubDescription(c: WorldClubHead): string {
  const name = clean(c.name)
  const place = [c.province ? clean(c.province) : '', c.country ? clean(c.country.name) : ''].filter(Boolean).join(', ')
  const leagues = [c.menLeague && `men's ${clean(c.menLeague)}`, c.womenLeague && `women's ${clean(c.womenLeague)}`].filter(Boolean)
  const parts = [`${name} is a field hockey club${place ? ` in ${place}` : ''}.`]
  if (leagues.length > 0) parts.push(`Plays in the ${leagues.join(' and the ')}.`)
  parts.push(c.isClaimed
    ? 'See the club, its open roles for players and coaches, and connect on Hockia.'
    : 'See the club in the Hockia world directory and find field hockey roles near it.')
  return parts.join(' ')
}

function breadcrumb(siteUrl: string, items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${siteUrl}${it.path}` })),
  }
}

export function countryJsonLd(c: WorldCountryHead, siteUrl: string): Record<string, unknown>[] {
  const path = `/world/${c.code.toLowerCase()}`
  const page: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: countryTitle(c).replace(/ \| Hockia$/, ''),
    description: countryDescription(c),
    url: `${siteUrl}${path}`,
    about: { '@type': 'Thing', name: 'Field hockey' },
  }
  if (c.clubs.length > 0) {
    page.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: c.totalClubs,
      itemListElement: c.clubs.map((club, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: clean(club.name),
        url: `${siteUrl}/world/clubs/${club.id}`,
      })),
    }
  }
  return [page, breadcrumb(siteUrl, [{ name: 'World', path: '/world' }, { name: clean(c.name), path }])]
}

export function clubJsonLd(c: WorldClubHead, siteUrl: string): Record<string, unknown>[] {
  const url = `${siteUrl}/world/clubs/${c.id}`
  const org: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SportsOrganization',
    name: clean(c.name),
    sport: 'Field hockey',
    url,
  }
  if (c.avatarUrl) org.logo = c.avatarUrl
  if (c.country) {
    org.address = {
      '@type': 'PostalAddress',
      addressCountry: c.country.code.toUpperCase(),
      ...(c.province ? { addressRegion: clean(c.province) } : {}),
    }
  }
  const leagues = [c.menLeague, c.womenLeague].filter((l): l is string => Boolean(l))
  if (leagues.length > 0) org.memberOf = leagues.map((l) => ({ '@type': 'SportsOrganization', name: clean(l), sport: 'Field hockey' }))
  const crumbs = [{ name: 'World', path: '/world' }]
  if (c.country) crumbs.push({ name: clean(c.country.name), path: `/world/${c.country.code.toLowerCase()}` })
  crumbs.push({ name: clean(c.name), path: `/world/clubs/${c.id}` })
  return [org, breadcrumb(siteUrl, crumbs)]
}

function applyHead(shell: string, title: string, description: string, canonical: string, jsonLd: Record<string, unknown>[], image?: string | null): string {
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  html = setMeta(html, 'name', 'title', title)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', canonical)
  html = setMeta(html, 'name', 'twitter:title', title)
  html = setMeta(html, 'name', 'twitter:description', description)
  html = setMeta(html, 'name', 'twitter:url', canonical)
  if (image) {
    html = setMeta(html, 'property', 'og:image', image)
    html = setMeta(html, 'name', 'twitter:image', image)
  }
  html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
  const scripts = jsonLd.map((j) => `<script type="application/ld+json" data-server="1">${jsonForScript(j)}</script>`).join('\n')
  return html.replace('</head>', `<link rel="canonical" href="${escapeHtml(canonical)}" />\n${scripts}\n</head>`)
}

export function renderCountryHtml(shell: string, c: WorldCountryHead, siteUrl: string): string {
  return applyHead(shell, countryTitle(c), countryDescription(c), `${siteUrl}/world/${c.code.toLowerCase()}`, countryJsonLd(c, siteUrl))
}

export function renderClubHtml(shell: string, c: WorldClubHead, siteUrl: string): string {
  return applyHead(shell, clubTitle(c), clubDescription(c), `${siteUrl}/world/clubs/${c.id}`, clubJsonLd(c, siteUrl), c.avatarUrl)
}
