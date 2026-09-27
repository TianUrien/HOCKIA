/**
 * Candidate role search — parse, eligibility, geography widening and copy.
 * Runs the same pure pipeline nl-search uses (runOpportunitySearch) against
 * fixture rows shaped like `public_opportunities`.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  buildIneligibleMessage,
  buildNoOpportunitiesMessage,
  buildOpportunityMessage,
  includeTestPublisherRoles,
  isStagingProject,
  mergeOpportunityRows,
  testPublisherRowsToOpportunityRows,
  withoutAppliedRoles,
  withoutOwnRoles,
  type TestPublisherRoleRow,
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

// ── Test accounts (staging only) ──────────────────────────────────────────

const STAGING_URL = 'https://ivjkdaylalhsteyyclvl.supabase.co'
const PROD_URL = 'https://xtertgftujnebubxgqit.supabase.co'

function testRow(p: Omit<Partial<TestPublisherRoleRow>, 'publisher'> & { publisher?: Partial<NonNullable<TestPublisherRoleRow['publisher']>> | null }): TestPublisherRoleRow {
  const base = row({})
  const { publisher, ...rest } = p
  return {
    id: base.id, title: '[QA] 4a Persist Test', opportunity_type: 'player', position: 'midfielder', gender: 'Men',
    location_city: 'London', location_country: 'England', application_deadline: null, benefits: [], custom_benefits: [],
    eu_passport_required: false, created_at: base.created_at, organization_name: null,
    publisher: publisher === null ? null : { full_name: 'E2E Test Club', avatar_url: null, is_test_account: true, onboarding_completed: true, is_blocked: false, frozen_minor_at: null, ...publisher },
    world_club: null,
    ...rest,
  }
}

Deno.test('test roles: only a test viewer on staging — production never shows them', () => {
  assert(includeTestPublisherRoles({ supabaseUrl: STAGING_URL, viewerIsTest: true }))
  assert(!includeTestPublisherRoles({ supabaseUrl: STAGING_URL, viewerIsTest: false }))
  assert(!includeTestPublisherRoles({ supabaseUrl: STAGING_URL, viewerIsTest: null }))
  assert(!includeTestPublisherRoles({ supabaseUrl: PROD_URL, viewerIsTest: true }))
  assert(!includeTestPublisherRoles({ supabaseUrl: PROD_URL, viewerIsTest: false }))
  assert(!includeTestPublisherRoles({ supabaseUrl: '', viewerIsTest: true }))
  assert(isStagingProject(STAGING_URL))
  assert(!isStagingProject(PROD_URL))
  assert(!isStagingProject(undefined))
})

Deno.test('test roles keep the view\'s other rules: onboarded, not blocked, not frozen', () => {
  const ok = testRow({})
  const rows = testPublisherRowsToOpportunityRows([
    ok,
    testRow({ publisher: { onboarding_completed: false } }),
    testRow({ publisher: { is_blocked: true } }),
    testRow({ publisher: { frozen_minor_at: '2026-01-01T00:00:00Z' } }),
    testRow({ publisher: { is_test_account: false } }),
    testRow({ publisher: null }),
  ])
  assertEquals(rows.map(r => r.id), [ok.id])
  assertEquals(rows[0].club_name, 'E2E Test Club')
})

Deno.test('staging test player: "open roles for me" finds the open test roles (#15)', () => {
  // The view only returns real publishers — on staging those are women's roles.
  const realWomen = row({ gender: 'Women', position: 'goalkeeper', location_country: 'Spain' })
  const persist = testRow({ title: '[QA] 4a Persist Test' })
  const argentina = testRow({ title: '[QA] 4b HP + Development', location_country: 'Argentina' })
  const viewer: Viewer = { role: 'player', gender: 'men', euEligible: false, position: 'midfielder', secondaryPosition: 'forward' }

  const before = runOpportunitySearch('open roles for me', [realWomen], COUNTRIES, viewer, TODAY)
  assertEquals(before.matched.length, 0)

  const pool = mergeOpportunityRows([realWomen], testPublisherRowsToOpportunityRows([persist, argentina]))
  const all = runOpportunitySearch('open roles for me', pool, COUNTRIES, viewer, TODAY)
  assertEquals(all.matched.map(r => r.id).sort(), [persist.id, argentina.id].sort())
  const mids = runOpportunitySearch('midfielder roles', pool, COUNTRIES, viewer, TODAY)
  assertEquals(mids.matched.length, 2)
  const england = runOpportunitySearch('roles in England', pool, COUNTRIES, viewer, TODAY)
  assertEquals(england.landed, 'original')
  assertEquals(england.matched.map(r => r.id), [persist.id])
})

Deno.test('merge: de-duplicates by id, newest first', () => {
  const a = row({ created_at: '2026-09-01T00:00:00Z' })
  const b = row({ created_at: '2026-09-20T00:00:00Z' })
  assertEquals(mergeOpportunityRows([a], [b, a]).map(r => r.id), [b.id, a.id])
})

Deno.test('roles already applied to are not offered again', () => {
  const a = row({})
  const b = row({})
  assertEquals(withoutAppliedRoles([a, b], [a.id]).map(r => r.id), [b.id])
  assertEquals(withoutAppliedRoles([a, b], []).length, 2)
})

Deno.test('a recruiting coach is never offered a role they published', () => {
  const own = row({ opportunity_type: 'coach', position: 'head_coach', gender: 'Men', title: "Head Coach — Men's team" })
  const clubs = row({ opportunity_type: 'coach', position: 'head_coach', gender: 'Boys', title: 'Coach Test 5' })
  const appliedTo = row({ opportunity_type: 'coach', position: 'head_coach', gender: null, title: 'Head Coach wanted' })
  assertEquals(withoutOwnRoles([own, clubs], [own.id]).map(r => r.id), [clubs.id])
  assertEquals(withoutOwnRoles([own, clubs], []).length, 2)
  // The pipeline nl-search runs: applied-to and own roles out, then search.
  const coach: Viewer = { role: 'coach', gender: 'men', euEligible: true, position: 'head_coach', secondaryPosition: null }
  const pool = withoutOwnRoles(withoutAppliedRoles([own, clubs, appliedTo], [appliedTo.id]), [own.id])
  const out = runOpportunitySearch('open roles for me', pool, COUNTRIES, coach, '2026-09-27')
  assertEquals(out.matched.map(r => r.title), ['Coach Test 5'])
})

Deno.test('round 5: "England" is labelled England — never "United Kingdom, England"', () => {
  const viewer: Viewer = { role: 'player', gender: 'men', euEligible: true, position: null, secondaryPosition: null }
  const c = parseOpportunityQuery('open roles in England', viewer, COUNTRIES)
  assertEquals(c.countryLabel, 'England')
  // United Kingdom still matches for filtering (England is one of its aliases).
  assert(c.countryNames.includes('united kingdom'))
  assert(c.countryNames.includes('england'))
  // Named through an alias only → the country itself.
  assertEquals(parseOpportunityQuery('roles in the UK', viewer, COUNTRIES).countryLabel, 'United Kingdom')
})

Deno.test('round 5: roles exist where asked but none the viewer can apply to → says so honestly', () => {
  const viewer: Viewer = { role: 'player', gender: 'men', euEligible: false, position: null, secondaryPosition: null }
  const englandEu = row({ location_country: 'England', eu_passport_required: true, gender: 'Men' })
  const englandWomen = row({ location_country: 'England', gender: 'Women' })
  const spain = row({ location_country: 'Spain', gender: 'Men' })

  // Nothing applyable anywhere.
  const none = runOpportunitySearch('open roles in England', [englandEu, englandWomen], COUNTRIES, viewer, TODAY)
  assertEquals(none.matched.length, 0)
  assertEquals(none.ineligibleInAsked, 2)
  assertEquals(buildIneligibleMessage(none.criteria, none.askedLabel), 'There are open roles in England, but none you can apply to right now.')

  // Widened to the region.
  const widened = runOpportunitySearch('open roles in England', [englandEu, englandWomen, spain], COUNTRIES, viewer, TODAY)
  assertEquals(widened.landed, 'region')
  assertEquals(widened.ineligibleInAsked, 2)
  assertEquals(
    buildIneligibleMessage(widened.criteria, widened.askedLabel, { count: widened.matched.length, region: widened.widenedRegion }),
    'There are open roles in England, but none you can apply to right now — here is 1 open role you can apply to elsewhere in Europe.',
  )

  // No roles there at all → the old "no roles" path (ineligibleInAsked 0).
  const empty = runOpportunitySearch('open roles in Germany', [spain], COUNTRIES, viewer, TODAY)
  assertEquals(empty.ineligibleInAsked, 0)

  // Applyable roles where asked → nothing to explain.
  const ok = runOpportunitySearch('open roles in Spain', [spain], COUNTRIES, viewer, TODAY)
  assertEquals(ok.landed, 'original')
  assertEquals(ok.ineligibleInAsked, 0)
})
