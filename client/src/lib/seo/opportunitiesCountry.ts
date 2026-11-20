/**
 * Open roles per country: /opportunities/in/:slug (2026-11-20).
 *
 * A page people and assistants can find for "open field hockey roles in
 * Australia". The slug is the country's English name (australia,
 * new-zealand), under /opportunities/in/ so it can never be read as a role
 * id (/opportunities/:uuid) or as /opportunities/applications. A country has
 * a page only while it has at least one open role; the edge function
 * api/opportunities-country.ts decides that on every serve.
 *
 * The roles come from the public-opportunities API (the public_opportunities
 * view applies the visibility rules, hidden publishers included). No people
 * are listed.
 *
 * No DOM, no imports from the app beyond the sibling seo helpers (bundled
 * into the edge functions with relative imports).
 */
import { COUNTRY_CODES, countryCode } from './countryCodes'
import { escapeHtml, jsonForScript, setMeta, type PublicOpportunityRow } from './opportunityHead'

export interface RoleCountry {
  /** ISO 3166-1 alpha-2, or a home nation (GB-ENG). */
  code: string
  /** English name as shown on the page. */
  name: string
  /** URL slug: the name in lower case with hyphens. */
  slug: string
}

/** Spellings roles use that are not the name the page shows. */
const ALIASES = new Set(['holland', 'the netherlands', 'uk', 'united states of america', 'usa'])
const SMALL_WORDS = new Set(['and', 'of', 'the'])
/** Countries that read with an article: "roles in the Netherlands". */
const WITH_ARTICLE = new Set(['BS', 'CF', 'CZ', 'DO', 'GB', 'GM', 'MV', 'NL', 'PH', 'AE', 'US', 'CD', 'KM', 'MH', 'SB', 'SC'])

export function countrySlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function displayName(key: string): string {
  return key
    .split(' ')
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-')))
    .join(' ')
}

const BY_CODE = new Map<string, RoleCountry>()
const BY_SLUG = new Map<string, RoleCountry>()
for (const [key, code] of Object.entries(COUNTRY_CODES)) {
  if (ALIASES.has(key) || BY_CODE.has(code)) continue
  const name = displayName(key)
  BY_CODE.set(code, { code, name, slug: countrySlug(name) })
}
for (const [key, code] of Object.entries(COUNTRY_CODES)) {
  const country = BY_CODE.get(code)
  if (country) BY_SLUG.set(countrySlug(key), country)
}

/**
 * The country a URL segment names: its slug (australia), another spelling
 * (usa) or its code (au). Null when it is not a country.
 */
export function resolveRoleCountry(segment: string | null | undefined): RoleCountry | null {
  const s = (segment ?? '').trim().toLowerCase()
  if (!/^[a-z][a-z-]{1,60}$/.test(s)) return null
  return BY_SLUG.get(s) ?? BY_CODE.get(s.toUpperCase()) ?? null
}

/** The country of a role, from the country name the club picked. */
export function countryOfRole(row: Pick<PublicOpportunityRow, 'location_country'>): RoleCountry | null {
  const code = countryCode(row.location_country)
  return code ? BY_CODE.get(code) ?? null : null
}

export function rolesInCountry(rows: PublicOpportunityRow[], country: RoleCountry): PublicOpportunityRow[] {
  return rows.filter((r) => countryOfRole(r)?.code === country.code)
}

/** Countries with at least one of these roles, by name. */
export function countriesWithRoles(rows: PublicOpportunityRow[]): RoleCountry[] {
  const seen = new Map<string, RoleCountry>()
  for (const r of rows) {
    const c = countryOfRole(r)
    if (c && !seen.has(c.code)) seen.set(c.code, c)
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** "Australia", "the Netherlands": the name as it reads after "in". */
export function inCountry(country: RoleCountry): string {
  return WITH_ARTICLE.has(country.code) ? `the ${country.name}` : country.name
}

export function countryRolesPath(country: RoleCountry): string {
  return `/opportunities/in/${country.slug}`
}

export function countryRolesHeading(country: RoleCountry): string {
  return `Open field hockey roles in ${inCountry(country)}`
}

export function countryRolesTitle(country: RoleCountry): string {
  return `Open Field Hockey Roles in ${inCountry(country)} – Jobs for Players & Coaches | Hockia`
}

export function countryRolesDescription(country: RoleCountry): string {
  return `Open field hockey roles in ${inCountry(country)} for players and coaches, published by clubs on Hockia. Read each role and apply directly. Hockia is free to join.`
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/** CollectionPage with the roles as an ItemList (each role URL carries its own JobPosting), plus breadcrumbs. */
export function countryRolesJsonLd(country: RoleCountry, roles: PublicOpportunityRow[], siteUrl: string): Record<string, unknown>[] {
  const url = `${siteUrl}${countryRolesPath(country)}`
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: countryRolesHeading(country),
      description: countryRolesDescription(country),
      url,
      about: { '@type': 'Thing', name: 'Field hockey' },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: roles.length,
        itemListElement: roles.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: clean(r.title), url: `${siteUrl}/opportunities/${r.id}` })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Open roles', item: `${siteUrl}/opportunities` },
        { '@type': 'ListItem', position: 2, name: country.name, item: url },
      ],
    },
  ]
}

/** The shell with the country page's title, description, self canonical, og:* and JSON-LD. */
export function renderCountryRolesHtml(shell: string, country: RoleCountry, roles: PublicOpportunityRow[], siteUrl: string): string {
  const title = countryRolesTitle(country)
  const description = countryRolesDescription(country)
  const canonical = `${siteUrl}${countryRolesPath(country)}`
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  html = setMeta(html, 'name', 'title', title)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', canonical)
  html = setMeta(html, 'name', 'twitter:title', title)
  html = setMeta(html, 'name', 'twitter:description', description)
  html = setMeta(html, 'name', 'twitter:url', canonical)
  html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
  const scripts = countryRolesJsonLd(country, roles, siteUrl)
    .map((j) => `<script type="application/ld+json" data-server="1">${jsonForScript(j)}</script>`)
    .join('\n')
  return html.replace('</head>', `<link rel="canonical" href="${escapeHtml(canonical)}" />\n${scripts}\n</head>`)
}
