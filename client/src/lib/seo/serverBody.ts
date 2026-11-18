/**
 * Server-rendered body text for public pages (AI search readability,
 * 2026-11-18).
 *
 * Most AI crawlers (and some search crawlers) do not run JavaScript. The
 * edge functions in client/api/ already inject a per-page head; these pure
 * helpers add a plain HTML block inside <div id="root"> with what the page
 * is about: open roles, clubs, leagues, the role description. The app mounts
 * with createRoot().render(), which replaces the block on boot, so visitors
 * with JavaScript see the app exactly as before.
 *
 * Everything listed comes from public sources that already apply the
 * visibility rules: roles from the public-opportunities API (the
 * public_opportunities view carries the hidden-profile predicate) and the
 * world directory tables. No people are listed.
 *
 * No DOM, no imports from the app beyond ./opportunityHead (bundled into the
 * edge functions with relative imports).
 */
import { BENEFIT_LABEL, escapeHtml, isStaleOpenRole, organisationName, roleLabel, type PublicOpportunityRow } from './opportunityHead'
import type { WorldClubHead, WorldCountryHead } from './worldHead'

/** Roles listed on /opportunities; the public API returns at most 100 a page. */
export const ROLE_LIST_MAX = 100

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function esc(s: string | null | undefined): string {
  return escapeHtml(clean(s))
}

/** Free text typed by a club: escaped, one <p> per paragraph. */
function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => clean(p))
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n')
}

function where(row: Pick<PublicOpportunityRow, 'location_city' | 'location_country'>): string {
  return [clean(row.location_city), clean(row.location_country)].filter(Boolean).join(', ')
}

/**
 * The shell with `inner` inside the app's mount node. Returns the shell
 * unchanged when the mount node is not the empty one this expects, or when
 * there is nothing to add.
 */
export function injectServerBody(shell: string, inner: string): string {
  if (!inner.trim()) return shell
  const mount = /<div id="root">\s*<\/div>/
  if (!mount.test(shell)) return shell
  const block =
    '<div id="root"><div data-server-body="1" style="max-width:720px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1f2937">\n' +
    `${inner}\n</div></div>`
  return shell.replace(mount, () => block)
}

const FOOTER =
  '<p><a href="/opportunities">Open field hockey roles</a> | <a href="/world">Field hockey clubs by country</a> | ' +
  '<a href="/community">Community</a> | <a href="/signup">Join Hockia free</a></p>'

/** One open role as a list item: title (link), organisation, city, country. */
function roleItem(row: PublicOpportunityRow): string {
  const place = where(row)
  return `<li><a href="/opportunities/${escapeHtml(row.id)}">${esc(row.title)}</a>, ${esc(roleLabel(row))} at ${esc(organisationName(row))}${place ? `, ${escapeHtml(place)}` : ''}</li>`
}

/** Roles the pages may advertise: the 90-day rule the sitemap and role pages already apply. */
export function advertisedRoles(rows: PublicOpportunityRow[], now: Date = new Date()): PublicOpportunityRow[] {
  return rows.filter((r) => !isStaleOpenRole(r, now))
}

/** /opportunities: the open roles, newest first as the API returns them. */
export function opportunitiesBody(rows: PublicOpportunityRow[], intro: string): string {
  const parts = ['<h1>Field hockey jobs and opportunities for players and coaches</h1>', `<p>${escapeHtml(intro)}</p>`]
  if (rows.length > 0) {
    parts.push(`<h2>${rows.length === 1 ? '1 open role' : `${rows.length} open roles`}</h2>`)
    parts.push(`<ul>\n${rows.map(roleItem).join('\n')}\n</ul>`)
  } else {
    parts.push('<p>There are no open roles listed right now.</p>')
  }
  parts.push(FOOTER)
  return parts.join('\n')
}

/** /opportunities/:id: the role as text, the description in full. */
export function roleBody(row: PublicOpportunityRow): string {
  const place = where(row)
  const facts: string[] = [`Role: ${esc(roleLabel(row))}`, `Organisation: ${esc(organisationName(row))}`]
  if (place) facts.push(`Location: ${escapeHtml(place)}`)
  if (row.start_date) facts.push(`Start date: ${escapeHtml(row.start_date)}`)
  if (clean(row.duration_text)) facts.push(`Duration: ${esc(row.duration_text)}`)
  if (row.application_deadline) facts.push(`Apply by: ${escapeHtml(row.application_deadline)}`)
  const parts = [
    `<h1>${esc(row.title)} at ${esc(organisationName(row))}</h1>`,
    `<ul>\n${facts.map((f) => `<li>${f}</li>`).join('\n')}\n</ul>`,
  ]
  if (clean(row.description)) parts.push('<h2>About the role</h2>', paragraphs(row.description ?? ''))
  const requirements = (row.requirements ?? []).map(clean).filter(Boolean)
  if (requirements.length > 0) parts.push('<h2>Requirements</h2>', `<ul>\n${requirements.map((r) => `<li>${escapeHtml(r)}</li>`).join('\n')}\n</ul>`)
  const benefits = [...(row.benefits ?? []).map((b) => BENEFIT_LABEL[b] ?? b), ...(row.custom_benefits ?? [])].map(clean).filter(Boolean)
  if (benefits.length > 0) parts.push('<h2>Benefits</h2>', `<ul>\n${benefits.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n')}\n</ul>`)
  parts.push(`<p>Apply on Hockia, the field hockey network. It is free for players and coaches.</p>`, FOOTER)
  return parts.join('\n')
}

export interface WorldCountryBody {
  /** Leagues in the country, best tier first. */
  leagues: string[]
  /** Regions with their own directory page. */
  provinces: { name: string; slug: string }[]
}

/** /world/:code: the clubs (links) and leagues of one country. */
export function countryBody(c: WorldCountryHead, extra: WorldCountryBody, description: string): string {
  const name = clean(c.name)
  const code = c.code.toLowerCase()
  const parts = [`<h1>Field hockey clubs in ${escapeHtml(name)}</h1>`, `<p>${escapeHtml(description)}</p>`]
  if (extra.leagues.length > 0) {
    parts.push(`<h2>Field hockey leagues in ${escapeHtml(name)}</h2>`, `<ul>\n${extra.leagues.map((l) => `<li>${esc(l)}</li>`).join('\n')}\n</ul>`)
  }
  if (extra.provinces.length > 0) {
    parts.push(
      '<h2>Regions</h2>',
      `<ul>\n${extra.provinces.map((p) => `<li><a href="/world/${escapeHtml(code)}/${escapeHtml(p.slug)}">${esc(p.name)}</a></li>`).join('\n')}\n</ul>`,
    )
  }
  if (c.clubs.length > 0) {
    const more = c.totalClubs > c.clubs.length ? ` (${c.clubs.length} of ${c.totalClubs})` : ''
    parts.push(
      `<h2>Clubs${more}</h2>`,
      `<ul>\n${c.clubs.map((club) => `<li><a href="/world/clubs/${escapeHtml(club.id)}">${esc(club.name)}</a></li>`).join('\n')}\n</ul>`,
    )
  }
  parts.push(FOOTER)
  return parts.join('\n')
}

/**
 * Open roles of one directory club, out of the public list. The public API
 * carries the organisation's name, not a club id, so the match is the name
 * (case and spacing ignored) within the club's country when both are known.
 */
export function rolesForClub(rows: PublicOpportunityRow[], c: Pick<WorldClubHead, 'name' | 'country'>): PublicOpportunityRow[] {
  const norm = (s: string | null | undefined) => clean(s).toLowerCase()
  const target = norm(c.name)
  if (!target) return []
  const country = norm(c.country?.name)
  return rows.filter((r) => {
    if (norm(organisationName(r)) !== target) return false
    const roleCountry = norm(r.location_country)
    return !country || !roleCountry || roleCountry === country
  })
}

/** /world/clubs/:id: name, place, leagues and open roles. */
export function clubBody(c: WorldClubHead, roles: PublicOpportunityRow[], description: string): string {
  const name = clean(c.name)
  const facts: string[] = []
  if (c.country) facts.push(`Country: <a href="/world/${escapeHtml(c.country.code.toLowerCase())}">${esc(c.country.name)}</a>`)
  if (clean(c.province)) facts.push(`Region: ${esc(c.province)}`)
  if (clean(c.menLeague)) facts.push(`Men's league: ${esc(c.menLeague)}`)
  if (clean(c.womenLeague)) facts.push(`Women's league: ${esc(c.womenLeague)}`)
  const parts = [`<h1>${escapeHtml(name)}, field hockey club</h1>`, `<p>${escapeHtml(description)}</p>`]
  if (facts.length > 0) parts.push(`<ul>\n${facts.map((f) => `<li>${f}</li>`).join('\n')}\n</ul>`)
  parts.push(`<h2>Open roles at ${escapeHtml(name)}</h2>`)
  parts.push(roles.length > 0
    ? `<ul>\n${roles.map(roleItem).join('\n')}\n</ul>`
    : `<p>No open roles listed right now. See <a href="/opportunities">all open field hockey roles</a>.</p>`)
  parts.push(FOOTER)
  return parts.join('\n')
}

/** /world: the countries in the directory, each linking to its page. */
export function worldBody(countries: { code: string; name: string; totalClubs: number }[], intro: string): string {
  const parts = ['<h1>Field hockey clubs by country</h1>', `<p>${escapeHtml(intro)}</p>`]
  if (countries.length > 0) {
    parts.push(`<ul>\n${countries.map((c) => `<li><a href="/world/${escapeHtml(c.code.toLowerCase())}">Field hockey clubs in ${esc(c.name)}</a>${c.totalClubs > 0 ? ` (${c.totalClubs})` : ''}</li>`).join('\n')}\n</ul>`)
  }
  parts.push(FOOTER)
  return parts.join('\n')
}
