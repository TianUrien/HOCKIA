/**
 * Server-side head for /opportunities/:id (SEO fix 2026-10-15).
 *
 * The Vercel edge function api/opportunity-page.ts fetches the SPA shell and
 * one row of the public_opportunities view, then uses these pure helpers to
 * inject a per-role <title>, description, canonical, og:* and a JobPosting
 * JSON-LD into the initial HTML, so Google (and Google for Jobs) read the
 * role without running the app. Closed or unknown roles get the shell with
 * noindex, which is how Google is told to drop them.
 *
 * No DOM, no imports from the app: this file is bundled into the edge
 * function with relative imports, so keep it dependency-free.
 */
import { countryCode } from './countryCodes'
import { resolveRouteMeta } from './routeMeta'

export interface PublicOpportunityRow {
  id: string
  title: string
  opportunity_type: 'player' | 'coach' | string | null
  position: string | null
  gender: string | null
  description: string | null
  location_city: string | null
  location_country: string | null
  start_date: string | null
  duration_text: string | null
  application_deadline: string | null
  requirements: string[] | null
  benefits: string[] | null
  custom_benefits: string[] | null
  published_at: string | null
  created_at: string
  club_name: string | null
  club_logo_url: string | null
  club_location: string | null
  organization_name: string | null
  world_club_name: string | null
  world_club_avatar_url: string | null
}

/** One role as the public-opportunities API returns it (supabase/functions/_shared/public-api-types.ts). */
export interface PublicApiOpportunity {
  id: string
  title: string
  opportunity_type: string
  position: string | null
  gender: string | null
  description: string | null
  location: { city: string; country: string }
  start_date: string | null
  duration: string | null
  application_deadline: string | null
  requirements: string[]
  benefits: string[]
  club: { name: string; logo_url: string | null; location: string | null; league: string | null; kind: 'club' | 'coach' }
  published_at: string | null
  created_at: string
}

/** The API object in the view-row shape the head builders take. */
export function fromPublicApi(o: PublicApiOpportunity): PublicOpportunityRow {
  const name = o.club?.name && o.club.name !== 'Unknown Club' ? o.club.name : null
  return {
    id: o.id,
    title: o.title,
    opportunity_type: o.opportunity_type,
    position: o.position,
    gender: o.gender,
    description: o.description,
    location_city: o.location?.city || null,
    location_country: o.location?.country || null,
    start_date: o.start_date,
    duration_text: o.duration,
    application_deadline: o.application_deadline,
    requirements: o.requirements ?? [],
    benefits: o.benefits ?? [],
    custom_benefits: null,
    published_at: o.published_at,
    created_at: o.created_at,
    club_name: name,
    club_logo_url: o.club?.logo_url ?? null,
    club_location: o.club?.location ?? null,
    organization_name: null,
    world_club_name: null,
    world_club_avatar_url: null,
  }
}

const POSITION_LABEL: Record<string, string> = {
  goalkeeper: 'Goalkeeper', defender: 'Defender', midfielder: 'Midfielder', forward: 'Forward',
  head_coach: 'Head Coach', assistant_coach: 'Assistant Coach', youth_coach: 'Youth Coach',
  goalkeeper_coach: 'Goalkeeper Coach', strength_conditioning: 'Strength & Conditioning Coach',
  performance_analyst: 'Performance Analyst', sports_scientist: 'Sports Scientist', other_coach: 'Coach',
}
const GENDER_PREFIX: Record<string, string> = { Men: "Men's", Women: "Women's", Girls: "Girls'", Boys: "Boys'", Mixed: 'Mixed' }
const BENEFIT_LABEL: Record<string, string> = {
  housing: 'Housing provided', car: 'Car provided', visa: 'Visa sponsorship', flights: 'Flight allowance',
  meals: 'Meals included', job: 'Employment opportunity', insurance: 'Health insurance',
  education: 'Education support', bonuses: 'Performance bonuses', equipment: 'Equipment provided',
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** JSON safe to sit inside a <script>: no `</script` or `<!--` can be formed. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

export function roleLabel(row: Pick<PublicOpportunityRow, 'position' | 'gender' | 'opportunity_type'>): string {
  const base = (row.position && POSITION_LABEL[row.position]) || (row.opportunity_type === 'coach' ? 'Coach' : 'Field Hockey Player')
  const prefix = row.gender ? GENDER_PREFIX[row.gender] : ''
  return prefix ? `${prefix} ${base}` : base
}

export function organisationName(row: PublicOpportunityRow): string {
  return row.club_name || row.organization_name || row.world_club_name || 'A field hockey club'
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** Role titles are typed by clubs: trim and collapse the whitespace they carry. */
function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

export function pageTitle(row: PublicOpportunityRow): string {
  return `${clean(row.title)} at ${organisationName(row)} | HOCKIA`
}

export function metaDescription(row: PublicOpportunityRow): string {
  const where = [row.location_city, row.location_country].filter(Boolean).join(', ')
  const lead = `${roleLabel(row)} role at ${organisationName(row)}${where ? ` in ${where}` : ''}.`
  const body = row.description ? ` ${row.description}` : ' Apply on HOCKIA, the field hockey network.'
  return truncate(lead + body, 160)
}

/**
 * Founder rule (15 Oct 2026, via the Analytics session): an open role with
 * NO application deadline stops being advertised to Google 90 days after it
 * was posted. It drops out of the sitemap and its page is served noindex
 * without a JobPosting; inside HOCKIA the role stays open. Roles with a
 * deadline keep validThrough = the deadline and expire through that.
 */
export const STALE_OPEN_ROLE_DAYS = 90

export function isStaleOpenRole(row: Pick<PublicOpportunityRow, 'application_deadline' | 'published_at' | 'created_at'>, now: Date = new Date()): boolean {
  if (row.application_deadline) return false
  const posted = new Date(row.published_at ?? row.created_at).getTime()
  if (Number.isNaN(posted)) return false
  return now.getTime() - posted > STALE_OPEN_ROLE_DAYS * 86_400_000
}

/** schema.org/JobPosting for one open role. `siteUrl` has no trailing slash. */
export function buildJobPosting(row: PublicOpportunityRow, siteUrl: string): Record<string, unknown> {
  const datePosted = (row.published_at ?? row.created_at).slice(0, 10)
  const where = [row.location_city, row.location_country].filter(Boolean).join(', ')
  const parts: string[] = []
  if (!row.description || row.description.length < 100) parts.push(`${organisationName(row)} is looking for a ${roleLabel(row)}${where ? ` in ${where}` : ''}.`)
  if (row.description) parts.push(row.description)
  if (row.duration_text) parts.push(`Duration: ${row.duration_text}.`)
  const benefits = [...(row.benefits ?? []).map((b) => BENEFIT_LABEL[b] ?? b), ...(row.custom_benefits ?? [])].filter(Boolean)
  const logo = row.club_logo_url || row.world_club_avatar_url || null
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: clean(row.title),
    description: parts.join(' '),
    datePosted,
    ...(row.application_deadline ? { validThrough: `${row.application_deadline}T23:59:59Z` } : {}),
    ...(row.start_date ? { jobStartDate: row.start_date } : {}),
    employmentType: row.opportunity_type === 'coach' ? 'CONTRACTOR' : 'FULL_TIME',
    occupationalCategory: roleLabel(row),
    ...(benefits.length ? { jobBenefits: benefits.join(', ') } : {}),
    ...(row.requirements?.length ? { qualifications: row.requirements.join('. ') } : {}),
    // Google Jobs accepts only Organization here (SportsTeam fails the Rich
    // Results Test, 2026-10-15). The club profile's own location is never
    // used: the role's jobLocation is the role's.
    hiringOrganization: { '@type': 'Organization', name: organisationName(row), ...(logo ? { logo } : {}) },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', ...(row.location_city ? { addressLocality: row.location_city } : {}), ...(row.location_country ? { addressCountry: countryCode(row.location_country) ?? row.location_country } : {}) } },
    directApply: true,
    url: `${siteUrl}/opportunities/${row.id}`,
    identifier: { '@type': 'PropertyValue', name: 'HOCKIA Opportunity ID', value: row.id },
  }
}

function setMeta(html: string, attr: 'name' | 'property', key: string, content: string): string {
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="[^"]*"\\s*/?>`)
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `${tag}\n</head>`)
}

/** The shell with the role's head: title, description, canonical, og:*, JSON-LD. */
export function renderOpportunityHtml(shell: string, row: PublicOpportunityRow, siteUrl: string): string {
  const title = pageTitle(row)
  const desc = metaDescription(row)
  const canonical = `${siteUrl}/opportunities/${row.id}`
  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  html = setMeta(html, 'name', 'title', title)
  html = setMeta(html, 'name', 'description', desc)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', desc)
  html = setMeta(html, 'property', 'og:url', canonical)
  html = setMeta(html, 'name', 'twitter:title', title)
  html = setMeta(html, 'name', 'twitter:description', desc)
  html = setMeta(html, 'name', 'twitter:url', canonical)
  html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
  const inject =
    `<link rel="canonical" href="${escapeHtml(canonical)}" />\n` +
    `<script type="application/ld+json" data-server="1">${jsonForScript(buildJobPosting(row, siteUrl))}</script>\n` +
    `<script>window.__SERVER_JSONLD__=true</script>\n`
  return html.replace('</head>', `${inject}</head>`)
}

/** The shell marked noindex (closed, draft or unknown role), canonical removed. */
export function renderNoindexHtml(shell: string): string {
  const html = shell.replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
  return html.replace('</head>', `<meta name="robots" content="noindex, nofollow" />\n</head>`)
}

/**
 * The shell with a static public route's head (title, description, self
 * canonical, og:*), from the same table RouteMeta uses on the client, so
 * /opportunities ranks under its own title instead of the homepage's.
 */
export function renderStaticHtml(shell: string, pathname: string, siteUrl: string): string {
  const meta = resolveRouteMeta(pathname)
  const canonical = meta.canonical.replace(/^https:\/\/inhockia\.com/, siteUrl)
  const title = meta.title ?? ''
  let html = shell
  if (title) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    html = setMeta(html, 'name', 'title', title)
    html = setMeta(html, 'property', 'og:title', title)
    html = setMeta(html, 'name', 'twitter:title', title)
  }
  html = setMeta(html, 'name', 'description', meta.description)
  html = setMeta(html, 'property', 'og:description', meta.description)
  html = setMeta(html, 'name', 'twitter:description', meta.description)
  html = setMeta(html, 'property', 'og:url', canonical)
  html = setMeta(html, 'name', 'twitter:url', canonical)
  html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
  const robots = meta.index ? '' : `<meta name="robots" content="noindex, nofollow" />\n`
  return html.replace('</head>', `<link rel="canonical" href="${escapeHtml(canonical)}" />\n${robots}</head>`)
}
