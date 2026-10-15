// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'

/**
 * ============================================================================
 * Dynamic Sitemap Generator - Edge Function
 * ============================================================================
 * 
 * Generates a dynamic XML sitemap for search engines and AI crawlers.
 * 
 * Includes:
 *   - Static pages (/, /opportunities, /signup, /community, /developers)
 *   - Dynamic opportunity pages (/opportunities/{id}) for all open, public opportunities
 * 
 * Excludes:
 *   - Closed/draft opportunities
 *   - Test account data
 *   - Private routes (dashboard, messages, settings, etc.)
 * 
 * ============================================================================
 */

const SITE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://www.inhockia.com'

// Static pages with their priorities and change frequencies
const STATIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/opportunities', priority: '0.9', changefreq: 'daily' },
  { path: '/community', priority: '0.8', changefreq: 'daily' },
  { path: '/world', priority: '0.7', changefreq: 'weekly' },
  { path: '/signup', priority: '0.7', changefreq: 'monthly' },
  { path: '/developers', priority: '0.6', changefreq: 'weekly' },
  { path: '/terms', priority: '0.3', changefreq: 'monthly' },
  { path: '/privacy-policy', priority: '0.3', changefreq: 'monthly' },
]

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function generateUrlEntry(
  loc: string,
  lastmod: string,
  changefreq: string,
  priority: string
): string {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
}

Deno.serve(async (req: Request) => {
  // GET builds the sitemap; HEAD (used by crawlers and uptime checks to
  // confirm the URL exists) gets the same headers with no body.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }
  const isHead = req.method === 'HEAD'

  try {
    // Service role client (shared singleton)
    const supabase = getServiceClient()

    // Fetch all open, public opportunities
    // Using the same criteria as public_opportunities view:
    // - status = 'open'
    // - club has onboarding_completed = true
    // - club is not a test account
    const { data: opportunities, error } = await supabase
      .from('opportunities')
      .select(`
        id,
        updated_at,
        created_at,
        published_at,
        application_deadline,
        club:profiles!opportunities_club_id_fkey(
          onboarding_completed,
          is_test_account
        )
      `)
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching opportunities:', error)
      throw error
    }

    // Founder rule (15 Oct 2026): an open role with no application deadline
    // stops being advertised 90 days after it was posted (same cut-off as
    // the role page's JobPosting, client/src/lib/seo/opportunityHead.ts).
    const STALE_OPEN_ROLE_DAYS = 90
    const staleBefore = Date.now() - STALE_OPEN_ROLE_DAYS * 86_400_000
    const isStale = (opp: any) =>
      !opp.application_deadline && new Date(opp.published_at ?? opp.created_at).getTime() < staleBefore

    // Filter to only include opportunities from valid clubs
    const validOpportunities = (opportunities || []).filter((opp: any) => {
      const club = opp.club
      return club && 
             club.onboarding_completed === true && 
             (club.is_test_account === false || club.is_test_account === null) &&
             !isStale(opp)
    })

    const today = formatDate(new Date())

    // Generate URL entries
    const urlEntries: string[] = []

    // Add static pages
    for (const page of STATIC_PAGES) {
      urlEntries.push(generateUrlEntry(
        `${SITE_URL}${page.path}`,
        today,
        page.changefreq,
        page.priority
      ))
    }

    // Add dynamic opportunity pages
    for (const opp of validOpportunities) {
      const lastmod = opp.updated_at 
        ? formatDate(new Date(opp.updated_at))
        : formatDate(new Date(opp.created_at))
      
      urlEntries.push(generateUrlEntry(
        `${SITE_URL}/opportunities/${opp.id}`,
        lastmod,
        'weekly',
        '0.8'
      ))
    }

    // World directory: countries that have clubs, and claimed clubs (the
    // ones with a real page behind them). Unclaimed directory rows are thin.
    const { data: countries } = await supabase
      .from('world_countries_with_directory')
      .select('country_code, total_clubs')
      .gt('total_clubs', 0)
    for (const c of countries ?? []) {
      if (!c.country_code) continue
      urlEntries.push(generateUrlEntry(`${SITE_URL}/world/${String(c.country_code).toLowerCase()}`, today, 'weekly', '0.6'))
    }
    const { data: clubs } = await supabase
      .from('world_clubs')
      .select('id, updated_at, created_at')
      .eq('is_claimed', true)
    for (const club of clubs ?? []) {
      const lastmod = formatDate(new Date(club.updated_at ?? club.created_at))
      urlEntries.push(generateUrlEntry(`${SITE_URL}/world/clubs/${club.id}`, lastmod, 'weekly', '0.5'))
    }

    // Generate the complete sitemap XML
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>`

    // Return XML response with caching headers
    return new Response(isHead ? null : sitemap, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600', // Cache for 1 hour
        'Access-Control-Allow-Origin': '*',
      },
    })

  } catch (error) {
    console.error('Sitemap generation error:', error)
    captureException(error, { functionName: 'sitemap' })
    
    // Return a minimal valid sitemap on error
    const fallbackSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/opportunities</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>`

    return new Response(isHead ? null : fallbackSitemap, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300', // Shorter cache on error
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
