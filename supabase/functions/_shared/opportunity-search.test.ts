/**
 * Candidate role search — parse, eligibility, geography widening and copy.
 * Runs the same pure pipeline nl-search uses (runOpportunitySearch) against
 * fixture rows shaped like `public_opportunities`.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  buildNoOpportunitiesMessage,
  buildOpportunityMessage,
  parseOpportunityQuery,
  runOpportunitySearch,
  toOpportunityResult,
  viewerCanApply,
  type CountryRef,
  type OpportunityRow,
  type Viewer,
} from './opportunity-search.ts'

const COUNTRIES: CountryRef[] = [
  { name: 'Spain', region: 'Europe' },
  { name: 'Germany', region: 'Europe' },
  { name: 'Netherlands', region: 'Europe' },
  { name: 'United Kingdom', region: 'Europe' },
  { name: 'England', region: 'Europe' },
  { name: 'Argentina', region: 'South America' },
  { name: 'Australia', region: 'Oceania' },
]

let seq = 0
function row(p: Partial<OpportunityRow>): OpportunityRow {
  seq++
  return {
    id: `opp-${seq}`,
    title: 'Role',
    opportunity_type: 'player',
    position: 'midfielder',
    gender: 'Mixed',
    location_city: 'City',
    location_country: 'Spain',
    application_deadline: null,
    benefits: [],
    custom_benefits: [],
    eu_passport_required: false,
    created_at: `2026-09-${String(10 + seq).padStart(2, '0')}T00:00:00Z`,
    club_name: 'Club',
    club_logo_url: null,
    organization_name: null,
    world_club_name: null,
    world_club_avatar_url: null,
    ...p,
  }
}

const PLAYER_M: Viewer = { role: 'player', gender: 'men', euEligible: true, position: 'midfielder', secondaryPosition: null }
const PLAYER_W: Viewer = { role: 'player', gender: 'women', euEligible: false, position: 'defender', secondaryPosition: 'midfielder' }
const COACH: Viewer = { role: 'coach', gender: null, euEligible: null, position: null, secondaryPosition: null }
const TODAY = '2026-09-26'

Deno.test('parse: position, region and package', () => {
  const c = parseOpportunityQuery('midfielder roles in Europe with housing', PLAYER_M, COUNTRIES)
  assertEquals(c.opportunityType, 'player')
  assertEquals(c.positions, ['midfielder'])
  assertEquals(c.regionLabel, 'Europe')
  assertEquals(c.benefits, ['housing'])
  assertEquals(c.countryNames, [])
})

Deno.test('parse: country aliases, team category, coach positions', () => {
  const uk = parseOpportunityQuery("women's goalkeeper roles in the UK", PLAYER_W, COUNTRIES)
  assertEquals(uk.genders, ['Women'])
  assertEquals(uk.positions, ['goalkeeper'])
  assert(uk.countryNames.includes('united kingdom'))
  const coach = parseOpportunityQuery('head coach roles in Germany', COACH, COUNTRIES)
  assertEquals(coach.opportunityType, 'coach')
  assertEquals(coach.positions, ['head_coach'])
  assertEquals(coach.countryLabel, 'Germany')
  // "goalkeeper coach" must not read as a goalkeeper role for a player.
  assertEquals(parseOpportunityQuery('goalkeeper coach roles', PLAYER_M, COUNTRIES).positions, [])
  // "roles for us" is not the USA.
  assertEquals(parseOpportunityQuery('roles for us', PLAYER_M, [{ name: 'United States', region: 'North America' }]).countryNames, [])
})

Deno.test('eligibility mirrors the application trigger', () => {
  assertEquals(viewerCanApply(row({ gender: 'Women' }), PLAYER_M), false)
  assertEquals(viewerCanApply(row({ gender: 'Men' }), PLAYER_W), false)
  assertEquals(viewerCanApply(row({ gender: 'Mixed' }), PLAYER_W), true)
  assertEquals(viewerCanApply(row({ eu_passport_required: true }), PLAYER_W), false)
  // Unknown nationality / gender never blocks.
  assertEquals(viewerCanApply(row({ eu_passport_required: true, gender: 'Women' }), { ...PLAYER_M, euEligible: null, gender: null }), true)
  // Coach roles are not gender-gated.
  assertEquals(viewerCanApply(row({ opportunity_type: 'coach', gender: 'Women' }), { ...COACH, gender: 'men' }), true)
})

Deno.test('search: only roles of the viewer type, open deadline, eligible, matching', () => {
  const rows = [
    row({ position: 'midfielder', location_country: 'Spain', benefits: ['housing'] }),
    row({ position: 'midfielder', location_country: 'Spain', benefits: [] }),            // no housing
    row({ position: 'midfielder', location_country: 'Spain', benefits: ['housing'], gender: 'Women' }), // not eligible
    row({ position: 'midfielder', location_country: 'Spain', benefits: ['housing'], application_deadline: '2026-09-01' }), // closed
    row({ opportunity_type: 'coach', position: 'head_coach', location_country: 'Spain', benefits: ['housing'] }),
  ]
  const out = runOpportunitySearch('midfielder roles in Spain with housing', rows, COUNTRIES, PLAYER_M, TODAY)
  assertEquals(out.matched.map(r => r.id), [rows[0].id])
  assertEquals(out.landed, 'original')
  assertEquals(out.askedLabel, 'Spain')
})

Deno.test('search: empty country widens to its region, then worldwide, naming the rung', () => {
  const inGermany = row({ location_country: 'Germany' })
  const inArgentina = row({ location_country: 'Argentina' })
  const region = runOpportunitySearch('midfielder roles in Spain', [inGermany, inArgentina], COUNTRIES, PLAYER_M, TODAY)
  assertEquals(region.landed, 'region')
  assertEquals(region.widenedRegion, 'Europe')
  assertEquals(region.matched.map(r => r.id), [inGermany.id])

  const world = runOpportunitySearch('midfielder roles in Spain', [inArgentina], COUNTRIES, PLAYER_M, TODAY)
  assertEquals(world.landed, 'worldwide')
  assertEquals(world.matched.map(r => r.id), [inArgentina.id])

  // Position is never widened away.
  const none = runOpportunitySearch('goalkeeper roles in Spain', [inGermany, inArgentina], COUNTRIES, PLAYER_M, TODAY)
  assertEquals(none.matched.length, 0)
  assertEquals(none.landed, 'original')
})

Deno.test('search: "clubs looking for a midfielder in Europe" (founder audit)', () => {
  const rows = [
    row({ position: 'midfielder', location_country: 'Netherlands' }),
    row({ position: 'forward', location_country: 'Netherlands' }),
    row({ position: 'midfielder', location_country: 'Argentina' }),
  ]
  const out = runOpportunitySearch('clubs looking for a midfielder in Europe', rows, COUNTRIES, PLAYER_M, TODAY)
  assertEquals(out.matched.map(r => r.id), [rows[0].id])
  assertEquals(out.askedLabel, 'Europe')
})

Deno.test('search: "open roles for me" orders own position first, then newest', () => {
  const olderMid = row({ position: 'midfielder', created_at: '2026-01-01T00:00:00Z' })
  const newerFwd = row({ position: 'forward', created_at: '2026-09-20T00:00:00Z' })
  const newerDef = row({ position: 'defender', created_at: '2026-09-21T00:00:00Z' })
  const out = runOpportunitySearch('open roles for me', [newerFwd, olderMid, newerDef], COUNTRIES, PLAYER_M, TODAY)
  assertEquals(out.matched.map(r => r.id), [olderMid.id, newerDef.id, newerFwd.id])
})

Deno.test('search: "for my position" filters to the viewer positions', () => {
  const def = row({ position: 'defender', gender: 'Women' })
  const mid = row({ position: 'midfielder', gender: 'Women' })
  const fwd = row({ position: 'forward', gender: 'Women' })
  const out = runOpportunitySearch('Find opportunities for my position', [def, mid, fwd], COUNTRIES, PLAYER_W, TODAY)
  assertEquals(out.matched.map(r => r.id).sort(), [def.id, mid.id].sort())
})

Deno.test('results carry human labels only — no enum values, scores or counts', () => {
  const r = toOpportunityResult(row({
    position: 'head_coach', opportunity_type: 'coach', gender: 'Men',
    benefits: ['housing', 'flights'], location_city: 'Berlin', location_country: 'Germany',
    organization_name: 'Org', world_club_name: null,
  }))
  assertEquals(r.position_label, 'Head coach')
  assertEquals(r.category_label, "Men's team")
  assertEquals(r.benefit_labels, ['Housing', 'Flights'])
  assertEquals(r.location_label, 'Berlin, Germany')
  assertEquals(r.navigate_to, `/opportunities/${r.id}`)
  const json = JSON.stringify(r)
  for (const banned of ['head_coach', 'adult_', 'open_to_', 'match', 'applicant', 'score']) {
    assert(!json.includes(banned), `result leaked "${banned}"`)
  }
})

Deno.test('copy is readable and gender-neutral', () => {
  const c = parseOpportunityQuery('midfielder roles in Europe with housing', PLAYER_M, COUNTRIES)
  assertEquals(buildOpportunityMessage(2, c, 'Europe'), 'I found 2 midfielder roles in Europe with housing you can apply to.')
  assertEquals(buildOpportunityMessage(1, c, 'Europe'), 'I found 1 midfielder role in Europe with housing you can apply to.')
  const msg = buildNoOpportunitiesMessage(c, 'Europe')
  assert(msg.startsWith('There are no midfielder roles in Europe with housing'))
  assert(!/\b(he|she|his|her|guys)\b/i.test(msg))
  assert(!/_/.test(msg))
})
