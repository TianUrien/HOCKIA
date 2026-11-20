/**
 * Shared public reads for the edge page functions (not a route: Vercel
 * ignores files that start with an underscore).
 */
import { fromPublicApi, type PublicApiOpportunity, type PublicOpportunityRow } from '../src/lib/seo/opportunityHead'
import { advertisedRoles, ROLE_LIST_MAX } from '../src/lib/seo/serverBody'
import { directoryFacts, weekWindows, type DirectoryFacts } from '../src/lib/seo/aboutFaq'

function env(): { base: string; key: string } | null {
  const base = (process.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const key = (process.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  return base && key ? { base, key } : null
}

/** One PostgREST read with the anon key; null on any failure. */
export async function restAnon<T>(query: string): Promise<T[] | null> {
  const e = env()
  if (!e) return null
  try {
    const res = await fetch(`${e.base}/rest/v1/${query}`, { headers: { apikey: e.key, accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T[]
  } catch (err) {
    console.error('[public-data] lookup failed', err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * The open roles the site advertises, newest first, through the
 * public-opportunities edge function: its view applies the visibility rules
 * (open roles of onboarded, non-test, non-hidden publishers), and the
 * 90-day rule is applied here as on the role pages. The visitor's IP is
 * forwarded so the API's per-IP rate limit counts the visitor. Null on any
 * failure, so the caller serves the page without the list.
 */
export async function fetchOpenRoles(clientIp: string | null): Promise<PublicOpportunityRow[] | null> {
  const e = env()
  if (!e) return null
  try {
    const res = await fetch(`${e.base}/functions/v1/public-opportunities?limit=${ROLE_LIST_MAX}`, {
      headers: {
        apikey: e.key,
        authorization: `Bearer ${e.key}`,
        accept: 'application/json',
        ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
      },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: PublicApiOpportunity[] }
    if (!Array.isArray(body.data)) return null
    return advertisedRoles(body.data.map(fromPublicApi))
  } catch (err) {
    console.error('[public-data] roles lookup failed', err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * What the world directory says now, for the countries answer on /faq:
 * countries with at least one club, and whether a club was added in each
 * of the last four weeks. Clubs only, no people. Unknown facts on failure,
 * so the page renders the sentence without a number.
 */
export async function fetchDirectoryFacts(now: Date = new Date()): Promise<DirectoryFacts> {
  const [countries, ...weeks] = await Promise.all([
    restAnon<{ total_clubs: number | null }>('world_countries_with_directory?select=total_clubs'),
    ...weekWindows(now).map((w) =>
      restAnon<{ id: string }>(`world_clubs?select=id&created_at=gte.${encodeURIComponent(w.from)}&created_at=lt.${encodeURIComponent(w.to)}&limit=1`),
    ),
  ])
  return directoryFacts(countries ? countries.map((c) => c.total_clubs) : null, weeks.map((w) => (w ? w.length > 0 : null)))
}
