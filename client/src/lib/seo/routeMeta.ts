/**
 * Per-route page metadata for the public web app (SEO fix 2026-10-15).
 *
 * Background: index.html carried ONE static canonical (the homepage) and one
 * og:url, served for every route, so Google read every page as a copy of the
 * homepage (GSC: 9 pages indexed, 16 roles "discovered, not indexed"). The
 * SPA shell (app.html) now ships without canonical/og:url and <RouteMeta>
 * sets them per route from this table; pages with dynamic data (profiles,
 * roles, world pages) keep setting their own title/description after it.
 *
 * Pure: no DOM here, so it is unit-tested.
 */

export const SITE_URL = 'https://inhockia.com'
export const DEFAULT_TITLE = 'Hockia – Where field hockey sticks together.'
export const DEFAULT_DESCRIPTION = 'Connect players, coaches, and clubs. Raise the sport together. Join Hockia.'

export interface RouteMetaEntry {
  /** Exact path, or a RegExp tested against the pathname. */
  match: string | RegExp
  /** Static title; omit when the page sets its own (dynamic) title. */
  title?: string
  description?: string
  /** false → <meta name="robots" content="noindex, nofollow">. Default true. */
  index?: boolean
}

/** Routes that are private, transactional or duplicates: never indexed. */
const NOINDEX: RegExp[] = [
  /^\/admin(\/|$)/, /^\/dashboard(\/|$)/, /^\/settings(\/|$)/, /^\/messages(\/|$)/, /^\/inbox(\/|$)/,
  /^\/home(\/|$)/, /^\/pulse(\/|$)/, /^\/search(\/|$)/, /^\/discover(y)?(\/|$)/, /^\/notifications(\/|$)/,
  /^\/complete-profile(\/|$)/, /^\/onboarding(\/|$)/, /^\/auth(\/|$)/, /^\/email-action(\/|$)/,
  /^\/verify-email(\/|$)/, /^\/forgot-password(\/|$)/, /^\/reset-password(\/|$)/, /^\/offline(\/|$)/,
  /^\/opportunities\/applications(\/|$)/, /^\/opportunities\/[^/]+\/applicants(\/|$)/, /^\/opportunities\/new(\/|$)/,
  /^\/saved(\/|$)/, /^\/shortlists?(\/|$)/, /^\/investors\/[^/]+/, /^\/invite\//, /^\/l\//,
  /^\/members\/id\//, /^\/players\/id\//, /^\/brands\/id\//, // id-form duplicates of the slug URLs
]

export const ROUTE_META: RouteMetaEntry[] = [
  { match: '/', title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION },
  { match: '/opportunities', title: 'Field Hockey Opportunities – Players & Coaches Worldwide | Hockia', description: 'Open field hockey opportunities for players and coaches: clubs across Europe, the Americas, Asia and Oceania recruiting on Hockia. Apply directly.' },
  { match: '/community', title: 'Field Hockey Community – Players, Coaches & Clubs | Hockia', description: 'Meet field hockey players, coaches, clubs and umpires from around the world on Hockia.' },
  { match: /^\/community\/[^/]+$/, title: 'Field Hockey Community | Hockia', description: 'Meet field hockey players, coaches, clubs and umpires from around the world on Hockia.' },
  { match: '/world', title: 'Field Hockey Clubs by Country – World Directory | Hockia', description: 'Browse field hockey clubs and leagues by country, region and division in the Hockia world directory.' },
  { match: '/marketplace', title: 'Field Hockey Brands & Gear | Hockia', description: 'Field hockey brands, sticks, equipment and offers for the Hockia community.' },
  { match: '/developers', title: 'Hockia for Developers – Public API & Data', description: 'Build on Hockia: public opportunities feed, sitemap and structured data for field hockey.' },
  { match: '/terms', title: 'Terms & Conditions | Hockia', description: 'The terms that apply when you use Hockia.' },
  { match: '/privacy-policy', title: 'Privacy Policy | Hockia', description: 'How Hockia collects, uses and protects your data.' },
  { match: '/signup', title: 'Join Hockia – Create your field hockey profile', description: 'Create a free Hockia profile as a player, coach, club, umpire or brand and get found by the field hockey world.' },
  { match: '/signup/email', title: 'Create your Hockia account with email', description: 'Sign up to Hockia with your email address.', index: false },
  { match: '/signin', title: 'Sign in | Hockia', description: 'Sign in to your Hockia account.', index: false },
  { match: '/juniors-waitlist', title: 'Hockia Juniors – Waitlist', description: 'Join the waitlist for Hockia Juniors.' },
]

export interface ResolvedRouteMeta {
  title: string | null
  description: string
  canonical: string
  index: boolean
}

/** Canonical URL for a pathname: apex site, no query, no trailing slash (except the root). */
export function canonicalFor(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '') || '/'
  return clean === '/' ? `${SITE_URL}/` : `${SITE_URL}${clean}`
}

export function resolveRouteMeta(pathname: string): ResolvedRouteMeta {
  const path = pathname.replace(/\/+$/, '') || '/'
  const entry = ROUTE_META.find((e) => (typeof e.match === 'string' ? e.match === path : e.match.test(path)))
  const noindex = entry?.index === false || NOINDEX.some((re) => re.test(path))
  return {
    title: entry?.title ?? null,
    description: entry?.description ?? DEFAULT_DESCRIPTION,
    canonical: canonicalFor(path),
    index: !noindex,
  }
}
