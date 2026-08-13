import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { buildSofteningLadder, describeSoftening, type GeoScope } from './geo-softening.ts'

const EUROPE = { regionLabel: 'Europe', countryIds: [1, 2, 3, 4, 5, 6, 7, 8] }
const scope = (o: Partial<GeoScope> = {}): GeoScope => ({
  baseCountryIds: null, baseLocationText: null, countryIds: null, ...o,
})

// ── When NOT to widen ─────────────────────────────────────────────────────
Deno.test('no geographic filter → no ladder at all', () => {
  // A zero here has nothing to do with location; widening would be answering
  // a question the user never asked.
  assertEquals(buildSofteningLadder(scope(), EUROPE), [])
})

Deno.test('blank location text does not count as a filter', () => {
  assertEquals(buildSofteningLadder(scope({ baseLocationText: '   ' }), EUROPE), [])
})

// ── The founder's case: city + country, no results ────────────────────────
Deno.test('city + country climbs city → region → worldwide', () => {
  const rungs = buildSofteningLadder(
    scope({ baseCountryIds: [1], baseLocationText: 'London' }), EUROPE,
  )
  assertEquals(rungs.map(r => r.step), ['city', 'region', 'worldwide'])

  // Rung 1 drops the city but HOLDS the country.
  assertEquals(rungs[0].overlay.p_base_location, null)
  assertEquals(rungs[0].overlay.p_base_country_ids, [1])

  // Rung 2 opens up to the region.
  assertEquals(rungs[1].overlay.p_base_country_ids, EUROPE.countryIds)
  assertEquals(rungs[1].overlay.p_base_location, null)

  // Rung 3 drops geography entirely.
  assertEquals(rungs[2].overlay, {
    p_base_location: null, p_base_country_ids: null, p_country_ids: null,
  })
})

Deno.test('city with NO country skips the redundant city rung', () => {
  // Dropping the city when nothing else pins the search IS the worldwide
  // rung — running both would fire the identical query twice.
  const rungs = buildSofteningLadder(scope({ baseLocationText: 'London' }), EUROPE)
  assertEquals(rungs.map(r => r.step), ['worldwide'])
})

// ── Widening only what was actually applied ───────────────────────────────
Deno.test('a null filter is never promoted to a region-wide list', () => {
  // p_country_ids was not part of the search; handing it the whole region
  // would ADD a constraint while claiming to remove one.
  const rungs = buildSofteningLadder(scope({ baseCountryIds: [1] }), EUROPE)
  const region = rungs.find(r => r.step === 'region')!
  assertEquals(region.overlay.p_base_country_ids, EUROPE.countryIds)
  assertEquals(region.overlay.p_country_ids, null)
})

Deno.test('world-club country widens on its own too', () => {
  const rungs = buildSofteningLadder(scope({ countryIds: [2] }), EUROPE)
  const region = rungs.find(r => r.step === 'region')!
  assertEquals(region.overlay.p_country_ids, EUROPE.countryIds)
  assertEquals(region.overlay.p_base_country_ids, null)
})

Deno.test('region rung is skipped when it would widen nothing', () => {
  // Already searching the entire region, or a region of one.
  const solo = { regionLabel: 'Oceania', countryIds: [9] }
  assertEquals(
    buildSofteningLadder(scope({ baseCountryIds: [9] }), solo).map(r => r.step),
    ['worldwide'],
  )
  assertEquals(
    buildSofteningLadder(scope({ baseCountryIds: [1, 2] }), EUROPE)
      .map(r => r.step).includes('region'),
    true,
  )
})

Deno.test('missing region data still yields the worldwide rung', () => {
  assertEquals(
    buildSofteningLadder(scope({ baseCountryIds: [1] }), null).map(r => r.step),
    ['worldwide'],
  )
})

// ── The copy is the honesty half — it must name the widening ──────────────
Deno.test('every rung states where the results actually are', () => {
  const city = describeSoftening('city', {
    noun: 'clubs', count: 3, cityLabel: 'London', countryLabel: 'England',
  })
  assertStringIncludes(city, 'London')
  assertStringIncludes(city, 'England')

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
    describeSoftening('region', { noun: 'clubs', count: 1, countryLabel: 'England', regionLabel: 'Europe' }),
    'here is 1',
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
