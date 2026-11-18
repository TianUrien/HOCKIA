import { describe, expect, it } from 'vitest'
import type { PublicOpportunityRow } from '@/lib/seo/opportunityHead'
import type { WorldClubHead, WorldCountryHead } from '@/lib/seo/worldHead'
import {
  advertisedRoles, clubBody, communityBody, countryBody, injectServerBody, opportunitiesBody, roleBody, rolesForClub, worldBody,
} from '@/lib/seo/serverBody'

const SHELL = '<html><head><title>t</title></head><body>\n    <div id="root"></div>\n    <script type="module" src="/assets/index-abc.js"></script>\n  </body></html>'

const role: PublicOpportunityRow = {
  id: '33333333-3333-3333-3333-333333333333', title: '  Head  Coach <Women> ', opportunity_type: 'coach', position: 'head_coach', gender: 'Women',
  description: 'Lead the first team.\n\nTwo sessions a week & match day.', location_city: 'Utrecht', location_country: 'Netherlands',
  start_date: '2027-08-01', duration_text: 'One season', application_deadline: '2027-03-01',
  requirements: ['Level 2 licence'], benefits: ['housing'], custom_benefits: ['Club car'],
  published_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T10:00:00Z',
  club_name: 'Test Hockey Club', club_logo_url: null, club_location: null, organization_name: null, world_club_name: null, world_club_avatar_url: null,
}

const club: WorldClubHead = {
  id: '22222222-2222-2222-2222-222222222222', name: 'Test Hockey Club', avatarUrl: null, isClaimed: true,
  country: { code: 'NL', name: 'Netherlands' }, province: 'Utrecht', menLeague: 'Hoofdklasse', womenLeague: null,
}

const country: WorldCountryHead = {
  code: 'NL', name: 'Netherlands', totalClubs: 120, totalLeagues: 4,
  clubs: [{ id: '22222222-2222-2222-2222-222222222222', name: 'Test Hockey Club' }],
}

describe('injectServerBody', () => {
  it('puts the block inside the mount node and keeps the entry script', () => {
    const html = injectServerBody(SHELL, '<h1>Hello</h1>')
    expect(html).toMatch(/<div id="root"><div data-server-body="1"[^>]*>\n<h1>Hello<\/h1>\n<\/div><\/div>/)
    expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>')
  })

  it('leaves the shell alone when there is nothing to add or no empty mount node', () => {
    expect(injectServerBody(SHELL, '  ')).toBe(SHELL)
    const prerendered = SHELL.replace('<div id="root"></div>', '<div id="root"><main>landing</main></div>')
    expect(injectServerBody(prerendered, '<h1>x</h1>')).toBe(prerendered)
  })

  it('does not treat "$" in the text as a replacement pattern', () => {
    expect(injectServerBody(SHELL, '<p>$& and $1</p>')).toContain('<p>$& and $1</p>')
  })
})

describe('opportunitiesBody', () => {
  it('lists each role with title, organisation, city, country and a link', () => {
    const html = opportunitiesBody([role], 'Open field hockey jobs.')
    expect(html).toContain('<h2>1 open role</h2>')
    expect(html).toContain('<a href="/opportunities/33333333-3333-3333-3333-333333333333">Head Coach &lt;Women&gt;</a>, Women\'s Head Coach at Test Hockey Club, Utrecht, Netherlands')
    expect(html).not.toContain('<Women>')
  })

  it('says so when no role is open', () => {
    expect(opportunitiesBody([], 'Intro.')).toContain('no open roles listed right now')
  })

  it('advertisedRoles drops roles past the 90-day rule', () => {
    const stale = { ...role, id: 'x', application_deadline: null, published_at: '2026-01-01T00:00:00Z' }
    expect(advertisedRoles([role, stale], new Date('2026-11-18T00:00:00Z')).map((r) => r.id)).toEqual([role.id])
  })
})

describe('roleBody', () => {
  it('carries the description as paragraphs, facts, requirements and benefits, all escaped', () => {
    const html = roleBody(role)
    expect(html).toContain('<h1>Head Coach &lt;Women&gt; at Test Hockey Club</h1>')
    expect(html).toContain('<p>Lead the first team.</p>\n<p>Two sessions a week &amp; match day.</p>')
    expect(html).toContain('<li>Location: Utrecht, Netherlands</li>')
    expect(html).toContain('<li>Apply by: 2027-03-01</li>')
    expect(html).toContain('<li>Level 2 licence</li>')
    expect(html).toContain('<li>Housing provided</li>')
    expect(html).toContain('<li>Club car</li>')
  })

  it('omits empty sections', () => {
    const html = roleBody({ ...role, description: null, requirements: [], benefits: [], custom_benefits: null })
    expect(html).not.toContain('About the role')
    expect(html).not.toContain('Requirements')
    expect(html).not.toContain('Benefits')
  })
})

describe('world bodies', () => {
  it('country: clubs link to their pages, leagues and regions are listed', () => {
    const html = countryBody(country, { leagues: ['Hoofdklasse'], provinces: [{ name: 'Utrecht', slug: 'utrecht' }] }, 'Desc.')
    expect(html).toContain('<h1>Field hockey clubs in Netherlands</h1>')
    expect(html).toContain('<li>Hoofdklasse</li>')
    expect(html).toContain('<a href="/world/nl/utrecht">Utrecht</a>')
    expect(html).toContain('<h2>Clubs (1 of 120)</h2>')
    expect(html).toContain('<a href="/world/clubs/22222222-2222-2222-2222-222222222222">Test Hockey Club</a>')
  })

  it('club: name, country link, leagues and its open roles', () => {
    const html = clubBody(club, [role], 'Desc.')
    expect(html).toContain('<h1>Test Hockey Club, field hockey club</h1>')
    expect(html).toContain('Country: <a href="/world/nl">Netherlands</a>')
    expect(html).toContain("<li>Men's league: Hoofdklasse</li>")
    expect(html).not.toContain("Women's league")
    expect(html).toContain('<a href="/opportunities/33333333-3333-3333-3333-333333333333">')
    expect(clubBody(club, [], 'Desc.')).toContain('No open roles listed right now')
  })

  it('rolesForClub matches the organisation name within the club country', () => {
    expect(rolesForClub([role], club)).toHaveLength(1)
    expect(rolesForClub([{ ...role, club_name: 'test  hockey CLUB' }], club)).toHaveLength(1)
    expect(rolesForClub([{ ...role, location_country: 'Belgium' }], club)).toHaveLength(0)
    expect(rolesForClub([{ ...role, club_name: 'Other Club' }], club)).toHaveLength(0)
  })

  it('world: one link per country', () => {
    const html = worldBody([{ code: 'AR', name: 'Argentina', totalClubs: 46 }], 'Intro.')
    expect(html).toContain('<a href="/world/ar">Field hockey clubs in Argentina</a> (46)')
  })

  it('community: says who the directory is for, with no people data and no counts', () => {
    const html = communityBody('Meet players & coaches.')
    expect(html).toContain('<h1>The field hockey community on Hockia</h1>')
    expect(html).toContain('<p>Meet players &amp; coaches.</p>')
    expect(html).toContain('players, coaches, clubs, umpires and brands in field hockey')
    for (const tab of ['players', 'coaches', 'clubs', 'umpires', 'brands']) expect(html).toContain(`<a href="/community/${tab}">`)
    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(/\d/)
    expect(injectServerBody(SHELL, html)).toContain('data-server-body="1"')
  })
})
