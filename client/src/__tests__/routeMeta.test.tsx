import { describe, expect, it } from 'vitest'
import { canonicalFor, resolveRouteMeta } from '@/lib/seo/routeMeta'
import { applyRouteMeta } from '@/lib/seo/applyRouteMeta'
import { buildJobPosting, fromPublicApi, isStaleOpenRole, metaDescription, renderNoindexHtml, renderOpportunityHtml, renderStaticHtml, type PublicOpportunityRow } from '@/lib/seo/opportunityHead'

describe('routeMeta', () => {
  it('canonical is the apex site, no query, no trailing slash', () => {
    expect(canonicalFor('/')).toBe('https://inhockia.com/')
    expect(canonicalFor('/opportunities/')).toBe('https://inhockia.com/opportunities')
    expect(canonicalFor('/world/ar')).toBe('https://inhockia.com/world/ar')
  })

  it('static pages get a title; dynamic pages keep theirs; private routes are noindex', () => {
    expect(resolveRouteMeta('/terms')).toMatchObject({ title: 'Terms & Conditions | HOCKIA', index: true })
    expect(resolveRouteMeta('/opportunities').title).toMatch(/Field Hockey Opportunities/)
    expect(resolveRouteMeta('/opportunities/123e4567-e89b-12d3-a456-426614174000')).toMatchObject({ title: null, index: true })
    expect(resolveRouteMeta('/members/juan')).toMatchObject({ title: null, index: true })
    expect(resolveRouteMeta('/members/id/abc').index).toBe(false) // duplicate of the slug URL
    expect(resolveRouteMeta('/admin/overview').index).toBe(false)
    expect(resolveRouteMeta('/messages').index).toBe(false)
    expect(resolveRouteMeta('/signin').index).toBe(false)
  })

  it('applyRouteMeta writes canonical, og:url, description and robots into the head', () => {
    document.head.innerHTML = '<title>x</title><meta name="description" content="old" />'
    applyRouteMeta('/privacy-policy')
    expect(document.title).toBe('Privacy Policy | HOCKIA')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://inhockia.com/privacy-policy')
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://inhockia.com/privacy-policy')
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/protects your data/)
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
    applyRouteMeta('/admin/overview')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    applyRouteMeta('/community')
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })
})

const row: PublicOpportunityRow = {
  id: '123e4567-e89b-12d3-a456-426614174000', title: 'Goalkeeper for 2027 season', opportunity_type: 'player', position: 'goalkeeper', gender: 'Women',
  description: 'First division club <b>needs</b> a keeper. </script><script>alert(1)</script>', location_city: 'Rotterdam', location_country: 'Netherlands',
  start_date: '2027-08-01', duration_text: 'One season', application_deadline: '2027-05-31', requirements: ['EU passport'], benefits: ['housing'], custom_benefits: ['Bike'],
  published_at: '2026-10-01T10:00:00Z', created_at: '2026-09-30T10:00:00Z', club_name: 'HC Rotterdam', club_logo_url: 'https://x/logo.png', club_location: 'Rotterdam',
  organization_name: null, world_club_name: null, world_club_avatar_url: null,
}
const shell = '<!doctype html><html><head><title>HOCKIA – default</title>\n<meta name="description" content="default" />\n<meta property="og:title" content="d" />\n<link rel="canonical" href="https://inhockia.com/" />\n</head><body></body></html>'

describe('opportunityHead', () => {
  it('builds a JobPosting with the required and recommended fields', () => {
    const jp = buildJobPosting(row, 'https://inhockia.com') as Record<string, unknown>
    expect(jp).toMatchObject({ '@type': 'JobPosting', title: row.title, datePosted: '2026-10-01', validThrough: '2027-05-31T23:59:59Z', employmentType: 'FULL_TIME', occupationalCategory: "Women's Goalkeeper", directApply: true })
    expect(jp.hiringOrganization).toEqual({ '@type': 'Organization', name: 'HC Rotterdam', logo: 'https://x/logo.png' }) // Organization only: Google rejects SportsTeam here
    expect(jp.jobLocation).toMatchObject({ address: { addressLocality: 'Rotterdam', addressCountry: 'NL' } }) // ISO code, not the name
    expect(jp.jobBenefits).toBe('Housing provided, Bike')
    expect(metaDescription(row)).toMatch(/^Women's Goalkeeper role at HC Rotterdam in Rotterdam, Netherlands\./)
    expect(metaDescription(row).length).toBeLessThanOrEqual(160)
  })

  it('injects title, description, canonical and JSON-LD without letting the description break out of the script', () => {
    const html = renderOpportunityHtml(shell, row, 'https://inhockia.com')
    expect(html).toContain('<title>Goalkeeper for 2027 season at HC Rotterdam | HOCKIA</title>')
    expect(renderOpportunityHtml(shell, { ...row, title: ' Senior  player ' }, 'https://inhockia.com')).toContain('<title>Senior player at HC Rotterdam | HOCKIA</title>') // club-typed whitespace never reaches the title
    expect(html).toContain('<link rel="canonical" href="https://inhockia.com/opportunities/123e4567-e89b-12d3-a456-426614174000" />')
    expect(html).not.toContain('href="https://inhockia.com/"')
    expect(html).toContain('<meta property="og:url" content="https://inhockia.com/opportunities/123e4567-e89b-12d3-a456-426614174000" />')
    expect(html).toContain('window.__SERVER_JSONLD__=true')
    const ld = html.match(/<script type="application\/ld\+json" data-server="1">([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(ld).not.toContain('</script')
    expect(JSON.parse(ld)['@type']).toBe('JobPosting')
    expect(html.match(/<meta name="description"/g)).toHaveLength(1)
  })

  it('noindex shell drops the canonical and adds robots', () => {
    const html = renderNoindexHtml(shell)
    expect(html).not.toContain('rel="canonical"')
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
  })
})

describe('fromPublicApi', () => {
  it('maps the public API object into the row shape and drops the placeholder club name', () => {
    const row = fromPublicApi({
      id: 'x', title: 'Senior Women’s First player', opportunity_type: 'player', position: 'midfielder', gender: 'Women', description: null,
      location: { city: 'Box Hill', country: 'Australia' }, start_date: '2027-03-22', duration: '12 months', application_deadline: null,
      requirements: [], benefits: ['housing', 'flights'], club: { name: 'Unknown Club', logo_url: null, location: 'Melbourne VIC, Australia', league: null, kind: 'coach' },
      published_at: '2026-10-15T12:48:56Z', created_at: '2026-10-15T12:48:56Z',
    })
    expect(row).toMatchObject({ location_city: 'Box Hill', location_country: 'Australia', duration_text: '12 months', club_name: null, club_location: 'Melbourne VIC, Australia' })
    expect(metaDescription(row)).toMatch(/^Women's Midfielder role at A field hockey club in Box Hill, Australia\./)
    expect(buildJobPosting(row, 'https://inhockia.com')).not.toHaveProperty('validThrough')
  })
})

describe('renderStaticHtml', () => {
  it('gives /opportunities its own title, description and self canonical', () => {
    const html = renderStaticHtml(shell, '/opportunities', 'https://inhockia.com')
    expect(html).toContain('<title>Field Hockey Opportunities – Player &amp; Coach Roles Worldwide | HOCKIA</title>')
    expect(html).toContain('<link rel="canonical" href="https://inhockia.com/opportunities" />')
    expect(html).toContain('<meta property="og:url" content="https://inhockia.com/opportunities" />')
    expect(html).not.toContain('href="https://inhockia.com/"')
    expect(html).not.toContain('name="robots"')
    expect(html.match(/<meta name="description"/g)).toHaveLength(1)
  })
})

describe('isStaleOpenRole (90-day rule)', () => {
  const now = new Date('2026-10-15T12:00:00Z')
  const base = { application_deadline: null, published_at: null, created_at: '2026-07-20T12:00:00Z' }
  it('a role with no deadline is stale after 90 days from when it was posted', () => {
    expect(isStaleOpenRole({ ...base, published_at: '2026-07-17T11:59:00Z' }, now)).toBe(true) // 90 days + 1 min
    expect(isStaleOpenRole({ ...base, published_at: '2026-07-17T12:01:00Z' }, now)).toBe(false) // just under 90 days
    expect(isStaleOpenRole(base, now)).toBe(false) // created_at used when never published: 87 days
  })
  it('a role with a deadline is never stale here: validThrough carries the deadline', () => {
    expect(isStaleOpenRole({ ...base, published_at: '2026-01-01T00:00:00Z', application_deadline: '2026-02-01' }, now)).toBe(false)
  })
})
