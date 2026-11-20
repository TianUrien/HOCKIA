/**
 * Open roles per country, /opportunities/in/:slug (2026-11-20): the country
 * lookup, the head and body the server sends, the routing that keeps the
 * page apart from role ids, and where crawlers find it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } } }))

import type { PublicOpportunityRow } from '@/lib/seo/opportunityHead'
import {
  countriesWithRoles, countryRolesDescription, countryRolesJsonLd, countryRolesTitle, countrySlug, renderCountryRolesHtml, resolveRoleCountry, rolesInCountry,
} from '@/lib/seo/opportunitiesCountry'
import { countryBody, countryRolesBody, opportunitiesBody } from '@/lib/seo/serverBody'
import { resolveRouteMeta } from '@/lib/seo/routeMeta'
import { CountryWordRedirect } from '@/pages/ClubRecruitingRoutes'

const root = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')
const SHELL = '<html><head><title>t</title><link rel="canonical" href="https://inhockia.com/" /></head><body><div id="root"></div></body></html>'

function role(id: string, title: string, country: string | null): PublicOpportunityRow {
  return {
    id, title, opportunity_type: 'player', position: 'forward', gender: 'Women', description: null,
    location_city: 'Perth', location_country: country, start_date: null, duration_text: null, application_deadline: '2027-03-01',
    requirements: [], benefits: [], custom_benefits: null, published_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T10:00:00Z',
    club_name: 'Test Hockey Club', club_logo_url: null, club_location: null, organization_name: null, world_club_name: null, world_club_avatar_url: null,
  }
}
const A1 = '11111111-1111-1111-1111-111111111111'
const A2 = '22222222-2222-2222-2222-222222222222'
const N1 = '33333333-3333-3333-3333-333333333333'
const roles = [role(A1, 'Striker <first team>', 'Australia'), role(N1, 'Forward', 'The Netherlands'), role(A2, 'Defender', 'australia '), role('x', 'Nowhere', 'Atlantis')]
const australia = resolveRoleCountry('australia')!

describe('country lookup', () => {
  it('reads a slug, another spelling and a code as the same country', () => {
    expect(australia).toEqual({ code: 'AU', name: 'Australia', slug: 'australia' })
    expect(resolveRoleCountry('AU')).toEqual(australia)
    expect(resolveRoleCountry('new-zealand')).toMatchObject({ code: 'NZ', name: 'New Zealand' })
    for (const s of ['usa', 'united-states-of-america', 'us']) expect(resolveRoleCountry(s)?.slug).toBe('united-states')
    for (const s of ['holland', 'the-netherlands', 'nl']) expect(resolveRoleCountry(s)?.slug).toBe('netherlands')
    expect(resolveRoleCountry('bosnia-and-herzegovina')?.name).toBe('Bosnia and Herzegovina')
    expect(resolveRoleCountry('guinea-bissau')?.name).toBe('Guinea-Bissau')
  })

  it('refuses what is not a country', () => {
    for (const s of ['atlantis', 'applications', 'new', '', null, 'a', '11111111-1111-1111-1111-111111111111', '../x']) expect(resolveRoleCountry(s)).toBeNull()
  })

  it('groups roles by the country the club picked, whatever the spelling', () => {
    expect(rolesInCountry(roles, australia).map((r) => r.id)).toEqual([A1, A2])
    expect(countriesWithRoles(roles).map((c) => c.slug)).toEqual(['australia', 'netherlands'])
    expect(countrySlug("Côte d'Ivoire")).toBe('cote-d-ivoire')
  })
})

describe('the page the server sends', () => {
  const mine = rolesInCountry(roles, australia)

  it('has its own title, description, canonical and an ItemList of role URLs', () => {
    const html = renderCountryRolesHtml(SHELL, australia, mine, 'https://inhockia.com')
    expect(html).toContain('<title>Open Field Hockey Roles in Australia – Jobs for Players &amp; Coaches | Hockia</title>')
    expect(html).toContain('<link rel="canonical" href="https://inhockia.com/opportunities/in/australia" />')
    expect(html.match(/rel="canonical"/g)).toHaveLength(1)
    expect(html).not.toContain('noindex')
    const [page, crumbs] = countryRolesJsonLd(australia, mine, 'https://inhockia.com') as [Record<string, never>, Record<string, never>]
    expect(page['@type']).toBe('CollectionPage')
    expect(page.mainEntity).toMatchObject({
      '@type': 'ItemList', numberOfItems: 2,
      itemListElement: [
        { position: 1, name: 'Striker <first team>', url: `https://inhockia.com/opportunities/${A1}` },
        { position: 2, name: 'Defender', url: `https://inhockia.com/opportunities/${A2}` },
      ],
    })
    expect(crumbs['@type']).toBe('BreadcrumbList')
    expect(html).not.toContain('<first team>')
  })

  it('lists the roles as text, with links to the role, the clubs and the full list', () => {
    const html = countryRolesBody(australia, mine, countryRolesDescription(australia), 'AU')
    expect(html).toContain('<h1>Open field hockey roles in Australia</h1>')
    expect(html).toContain('<h2>2 open roles in Australia</h2>')
    expect(html).toContain(`<a href="/opportunities/${A1}">Striker &lt;first team&gt;</a>`)
    expect(html).toContain('<a href="/world/au">Field hockey clubs in Australia</a>')
    expect(html).toContain('<a href="/opportunities">All open field hockey roles</a>')
    expect(countryRolesBody(australia, mine, 'd', null)).not.toContain('/world/au')
    expect(html).not.toContain('·')
  })

  it('reads naturally for countries that take an article', () => {
    const nl = resolveRoleCountry('netherlands')!
    expect(countryRolesTitle(nl)).toContain('Roles in the Netherlands')
    expect(countryRolesBody(nl, rolesInCountry(roles, nl), 'd', null)).toContain('<h2>1 open role in the Netherlands</h2>')
  })
})

describe('links for crawlers', () => {
  it('/opportunities links each country that has an open role', () => {
    const html = opportunitiesBody(roles, 'Intro.')
    expect(html).toContain('<h2>Open roles by country</h2>')
    expect(html).toContain('<a href="/opportunities/in/australia">Open field hockey roles in Australia</a>')
    expect(html).toContain('<a href="/opportunities/in/netherlands">Open field hockey roles in the Netherlands</a>')
    expect(opportunitiesBody([], 'Intro.')).not.toContain('Open roles by country')
  })

  it('/world/:code links the page only when the country has open roles', () => {
    const head = { code: 'AU', name: 'Australia', totalClubs: 7, totalLeagues: 0, clubs: [] }
    expect(countryBody(head, { leagues: [], provinces: [], openRoles: australia }, 'd')).toContain('<a href="/opportunities/in/australia">Open field hockey roles in Australia</a>')
    expect(countryBody(head, { leagues: [], provinces: [], openRoles: null }, 'd')).not.toContain('/opportunities/in/')
  })

  it('llms.txt and the sitemap function name the URL shape', () => {
    expect(read('public/llms.txt')).toContain('https://inhockia.com/opportunities/in/australia')
    expect(read('../supabase/functions/sitemap/index.ts')).toContain('/opportunities/in/${slug}')
  })
})

describe('routing', () => {
  const vercel = JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[] }
  const index = (source: string) => vercel.rewrites.findIndex((r) => r.source === source)
  const countrySource = '/opportunities/in/:slug([a-zA-Z][a-zA-Z-]{1,60})'
  const wordSource = '/opportunities/:word((?!applications$|new$)[a-zA-Z][a-zA-Z-]{1,60})'

  it('sends the country page and bare words to the edge function, ahead of the app shell', () => {
    expect(vercel.rewrites[index(countrySource)].destination).toBe('/api/opportunities-country?country=:slug')
    expect(vercel.rewrites[index(wordSource)].destination).toBe('/api/opportunities-country?word=:word')
    const shell = vercel.rewrites.findIndex((r) => r.destination === '/app.html')
    expect(index(countrySource)).toBeLessThan(shell)
    expect(index(wordSource)).toBeLessThan(shell)
  })

  it('a bare word never takes a role id or the personal pages', () => {
    const word = new RegExp(`^/opportunities/${wordSource.slice(wordSource.indexOf('('))}$`)
    expect(word.test('/opportunities/australia')).toBe(true)
    for (const p of ['/opportunities/applications', '/opportunities/new', `/opportunities/${A1}`, '/opportunities/in/australia', '/opportunities']) expect(word.test(p), p).toBe(false)
  })

  it('the country page is indexable with a self canonical; the personal pages stay noindex', () => {
    expect(resolveRouteMeta('/opportunities/in/australia')).toMatchObject({ index: true, dynamic: true, canonical: 'https://inhockia.com/opportunities/in/australia' })
    expect(resolveRouteMeta('/opportunities/applications').index).toBe(false)
  })

  function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>
  }
  const at = (word: string) =>
    render(
      <MemoryRouter initialEntries={[`/opportunities/${word}`]}>
        <Routes>
          <Route path="/opportunities/in/:slug" element={<Where />} />
          <Route path="*" element={<CountryWordRedirect word={word} fallback={<div data-testid="role-page" />} />} />
        </Routes>
      </MemoryRouter>,
    )

  it('in the app, /opportunities/australia goes to the country page and other words stay on the role page', () => {
    at('australia')
    expect(screen.getByTestId('where').textContent).toBe('/opportunities/in/australia')
  })

  it('in the app, a word that is not a country keeps the role page', () => {
    at('atlantis')
    expect(screen.getByTestId('role-page')).toBeTruthy()
  })
})
