import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { buildSofteningLadder, describeSoftening, type GeoScope } from './geo-softening.ts'

const EUROPE = { regionLabel: 'Europe', countryIds: [1, 2, 3, 4, 5, 6, 7, 8] }
const scope = (o: Partial<GeoScope> = {}): GeoScope => ({
  countryIds: null, hasSubCountry: false, ...o,
})

// ── When NOT to widen ─────────────────────────────────────────────────────
Deno.test('no geographic filter → no ladder at all', () => {
  // A zero here has nothing to do with location; widening would be answering
  // a question the user never asked.
  assertEquals(buildSofteningLadder(scope(), EUROPE), [])
})

// ── The founder's case: city + country, no results ────────────────────────
Deno.test('city + country climbs city → region → worldwide', () => {
  const rungs = buildSofteningLadder(
    scope({ countryIds: [1], hasSubCountry: true }), EUROPE,
  )
  assertEquals(rungs.map(r => r.step), ['city', 'region', 'worldwide'])

  // Rung 1 drops the city but HOLDS the country.
  assertEquals(rungs[0].keepSubCountry, false)
  assertEquals(rungs[0].countryMode, 'original')

  // Rung 2 opens up to the region, rung 3 drops geography entirely.
  assertEquals(rungs[1].countryMode, 'region')
  assertEquals(rungs[2].countryMode, 'none')
})

Deno.test('sub-country with NO country skips the redundant city rung', () => {
  // Dropping the city when nothing else pins the search IS the worldwide
  // rung — running both would fire the identical query twice.
  const rungs = buildSofteningLadder(scope({ hasSubCountry: true }), EUROPE)
  assertEquals(rungs.map(r => r.step), ['worldwide'])
})

Deno.test('country with no sub-country starts at the region rung', () => {
  assertEquals(
    buildSofteningLadder(scope({ countryIds: [1] }), EUROPE).map(r => r.step),
    ['region', 'worldwide'],
  )
})

Deno.test('region rung is skipped when it would widen nothing', () => {
  // Already searching the entire region, or a region of one.
  const solo = { regionLabel: 'Oceania', countryIds: [9] }
  assertEquals(
    buildSofteningLadder(scope({ countryIds: [9] }), solo).map(r => r.step),
    ['worldwide'],
  )
  assertEquals(
    buildSofteningLadder(scope({ countryIds: [1, 2] }), EUROPE)
      .map(r => r.step).includes('region'),
    true,
  )
})

Deno.test('missing region data still yields the worldwide rung', () => {
  assertEquals(
    buildSofteningLadder(scope({ countryIds: [1] }), null).map(r => r.step),
    ['worldwide'],
  )
})

Deno.test('the ladder never repeats a rung, so no query runs twice', () => {
  for (const s of [
    scope({ countryIds: [1], hasSubCountry: true }),
    scope({ countryIds: [1] }),
    scope({ hasSubCountry: true }),
  ]) {
    const steps = buildSofteningLadder(s, EUROPE).map(r => r.step)
    assertEquals(steps.length, new Set(steps).size)
  }
})

// ── The copy is the honesty half — it must name the widening ──────────────
Deno.test('every rung states where the results actually are', () => {
  const city = describeSoftening('city', {
    noun: 'clubs', count: 3, cityLabel: 'London', countryLabel: 'England',
  })
  assertStringIncludes(city, 'London')
  assertStringIncludes(city, 'England')
  assertStringIncludes(city, '3 clubs')

  const region = describeSoftening('region', {
    noun: 'clubs', count: 6, cityLabel: 'London', countryLabel: 'England', regionLabel: 'Europe',
  })
  assertStringIncludes(region, 'Europe')
  assertStringIncludes(region, '6')

  const world = describeSoftening('worldwide', {
    noun: 'clubs', count: 24, countryLabel: 'England',
  })
  assertStringIncludes(world, 'England')
  assertStringIncludes(world, 'elsewhere in the world')
})

Deno.test('singular count reads correctly', () => {
  assertStringIncludes(
    describeSoftening('region', {
      noun: 'clubs', nounSingular: 'club', count: 1,
      countryLabel: 'England', regionLabel: 'Europe',
    }),
    'here is 1 club ',
  )
})

Deno.test('city rung does not name the same place on both sides', () => {
  // The parse often puts a COUNTRY in the location text, which produced
  // "No clubs in United Kingdom itself — here is 1 in United Kingdom."
  const msg = describeSoftening('city', {
    noun: 'clubs', nounSingular: 'club', count: 1,
    cityLabel: 'United Kingdom', countryLabel: 'United Kingdom',
  })
  assertEquals(msg, 'Here is 1 club in United Kingdom.')
  assertEquals(msg.includes('itself'), false)
})

Deno.test('city rung still contrasts when the labels genuinely differ', () => {
  assertEquals(
    describeSoftening('city', {
      noun: 'clubs', nounSingular: 'club', count: 1,
      cityLabel: 'London', countryLabel: 'England',
    }),
    'No clubs in London itself — here is 1 club elsewhere in England.',
  )
})

Deno.test('labels from the LLM parse are sanitized before hitting the bubble', () => {
  const msg = describeSoftening('region', {
    noun: 'clubs', count: 2,
    cityLabel: 'Lon\ndon •─ <script>', regionLabel: 'Europe',
  })
  assertEquals(msg.includes('\n'), false)
  assertEquals(msg.includes('•'), false)
  assertEquals(msg.includes('<'), false)
})

Deno.test('an over-long label is capped, not passed through', () => {
  const msg = describeSoftening('worldwide', { noun: 'clubs', count: 1, cityLabel: 'x'.repeat(200) })
  assertEquals(msg.includes('x'.repeat(41)), false)
})
