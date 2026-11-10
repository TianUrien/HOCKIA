import { describe, expect, it } from 'vitest'
import { resolveRouteMeta } from '@/lib/seo/routeMeta'
import { applyRouteMeta } from '@/lib/seo/applyRouteMeta'
import {
  clubDescription, clubJsonLd, clubTitle, countryDescription, countryJsonLd, countryTitle,
  renderClubHtml, renderCountryHtml, type WorldClubHead, type WorldCountryHead,
} from '@/lib/seo/worldHead'

const SHELL = '<html><head><title>HOCKIA – Where field hockey sticks together.</title>' +
  '<meta name="description" content="generic" /><meta property="og:url" content="https://inhockia.com/" />' +
  '<link rel="canonical" href="https://inhockia.com/" /></head><body></body></html>'
const SITE = 'https://inhockia.com'

const country: WorldCountryHead = {
  code: 'AR', name: 'Argentina', totalClubs: 46, totalLeagues: 3,
  clubs: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Club  San Fernando' }],
}

const club: WorldClubHead = {
  id: '22222222-2222-2222-2222-222222222222', name: 'United Hockey Club', avatarUrl: 'https://cdn.example/crest.png',
  isClaimed: true, country: { code: 'AU', name: 'Australia' }, province: 'ACT', menLeague: 'Premier League', womenLeague: null,
}

describe('worldHead: country', () => {
  it('title and description name field hockey, the country and the real counts', () => {
    expect(countryTitle(country)).toBe('Field Hockey Clubs in Argentina – Leagues & Clubs | Hockia')
    expect(countryDescription(country)).toMatch(/^46 field hockey clubs and 3 leagues in Argentina:/)
    expect(countryDescription({ ...country, totalClubs: 1, totalLeagues: 0 })).toMatch(/^1 field hockey club in Argentina:/)
    expect(countryDescription({ ...country, totalClubs: 0 })).toMatch(/^Field hockey clubs and leagues in Argentina:/)
  })

  it('JSON-LD is a CollectionPage with the club list and a breadcrumb', () => {
    const [page, crumbs] = countryJsonLd(country, SITE)
    expect(page['@type']).toBe('CollectionPage')
    expect(page.url).toBe('https://inhockia.com/world/ar')
    expect((page.mainEntity as { numberOfItems: number }).numberOfItems).toBe(46)
    const first = (page.mainEntity as { itemListElement: { name: string; url: string }[] }).itemListElement[0]
    expect(first).toMatchObject({ name: 'Club San Fernando', url: 'https://inhockia.com/world/clubs/11111111-1111-1111-1111-111111111111' })
    expect(crumbs['@type']).toBe('BreadcrumbList')
  })

  it('renders the shell with its own title, description and canonical (no homepage canonical left)', () => {
    const html = renderCountryHtml(SHELL, country, SITE)
    expect(html).toContain('<title>Field Hockey Clubs in Argentina – Leagues &amp; Clubs | Hockia</title>')
    expect(html).toContain('<link rel="canonical" href="https://inhockia.com/world/ar" />')
    expect(html).not.toContain('href="https://inhockia.com/" />')
    expect(html).toContain('<meta property="og:url" content="https://inhockia.com/world/ar" />')
    expect(html).not.toContain('content="generic"')
    expect(html).toContain('"@type":"CollectionPage"')
  })
})

describe('worldHead: club', () => {
  it('title and description say field hockey club, place and leagues', () => {
    expect(clubTitle(club)).toBe('United Hockey Club – Field Hockey Club in Australia | Hockia')
    expect(clubTitle({ ...club, country: null })).toBe('United Hockey Club – Field Hockey Club | Hockia')
    expect(clubDescription(club)).toBe(
      "United Hockey Club is a field hockey club in ACT, Australia. Plays in the men's Premier League. See the club, its open roles for players and coaches, and connect on Hockia.",
    )
    expect(clubDescription({ ...club, isClaimed: false, menLeague: null, province: null })).toMatch(/in Australia\. See the club in the Hockia world directory/)
  })

  it('JSON-LD is a field hockey SportsOrganization with ISO country and leagues', () => {
    const [org, crumbs] = clubJsonLd(club, SITE)
    expect(org).toMatchObject({
      '@type': 'SportsOrganization', sport: 'Field hockey', name: 'United Hockey Club', logo: 'https://cdn.example/crest.png',
      address: { '@type': 'PostalAddress', addressCountry: 'AU', addressRegion: 'ACT' },
    })
    expect(org.memberOf).toEqual([{ '@type': 'SportsOrganization', name: 'Premier League', sport: 'Field hockey' }])
    expect((crumbs.itemListElement as unknown[]).length).toBe(3)
  })

  it('escapes club names typed by members', () => {
    const html = renderClubHtml(SHELL, { ...club, name: 'A&B </script><script>x' }, SITE)
    expect(html).toContain('<title>A&amp;B &lt;/script&gt;&lt;script&gt;x – Field Hockey Club in Australia | Hockia</title>')
    expect(html).not.toContain('</script><script>x')
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/crest.png" />')
  })
})

describe('client keeps the server description on world and role pages', () => {
  it('world and role routes are dynamic; static routes are not', () => {
    expect(resolveRouteMeta('/world/ar').dynamic).toBe(true)
    expect(resolveRouteMeta('/world/clubs/22222222-2222-2222-2222-222222222222').dynamic).toBe(true)
    expect(resolveRouteMeta('/opportunities/123e4567-e89b-12d3-a456-426614174000').dynamic).toBe(true)
    expect(resolveRouteMeta('/world').dynamic).toBe(false)
    expect(resolveRouteMeta('/opportunities').dynamic).toBe(false)
  })

  it('applyRouteMeta leaves a dynamic page description alone', () => {
    document.head.innerHTML = '<title>x</title><meta name="description" content="46 field hockey clubs in Argentina" />'
    applyRouteMeta('/world/ar')
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('46 field hockey clubs in Argentina')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://inhockia.com/world/ar')
  })
})
