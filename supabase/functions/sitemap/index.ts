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
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

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

    // Filter to only include opportunities from valid clubs
    const validOpportunities = (opportunities || []).filter((opp: any) => {
      const club = opp.club
      return club && 
             club.onboarding_completed === true && 
             (club.is_test_account === false || club.is_test_account === null)
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

    // Generate the complete sitemap XML
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>`

    // Return XML response with caching headers
    return new Response(sitemap, {
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

    return new Response(fallbackSitemap, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300', // Shorter cache on error
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
