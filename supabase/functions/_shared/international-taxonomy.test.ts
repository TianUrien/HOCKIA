/**
 * Eval suite for international/representative experience — the parse layer.
 *
 * These are the design-doc §10 queries. The INCIDENT case is verbatim from
 * discovery_events 2026-07-23 and must never regress: a country bound to a
 * national-team phrase is representative experience, NOT nationality.
 *
 * Run: deno test supabase/functions/_shared/international-taxonomy.test.ts
 */
import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  detectInternationalIntent,
  countryMentionedOutsideSpans,
  stripNationalTeamPhrases,
  hasNationalTeamIntent,
  rowTextLevel,
  tournamentAliasPatterns,
} from './international-taxonomy.ts'

// ── The incident, verbatim ───────────────────────────────────────────────

Deno.test('INCIDENT: Argentina national team query binds country to intl experience', () => {
  const q = "I'm looking for players who played in the Argentina national team"
  const intent = detectInternationalIntent(q)
  assert(intent, 'must detect NT intent')
  assertEquals(intent!.country_tokens, ['Argentina'])
  assertEquals(intent!.tournaments, [])
  // Argentina appears ONLY inside the NT phrase → must NOT stay a nationality.
  assertEquals(countryMentionedOutsideSpans(q, 'Argentina', intent!.spans), false)
})

Deno.test('INCIDENT #2: "Argentina selection national team" loses its clubs-router bait', () => {
  const q = 'Are there any Argentina selection national team in the app?'
  assert(hasNationalTeamIntent(q))
  const stripped = stripNationalTeamPhrases(q)
  // The word "team" (the clubs-router signal that hijacked this query to the
  // world-club directory) must be gone from the scoring input.
  assert(!/\bteams?\b/i.test(stripped), `"team" still present in: "${stripped}"`)
})

// ── Design-doc §10 eval set ──────────────────────────────────────────────

Deno.test('ES: jugadoras de la selección de España', () => {
  const intent = detectInternationalIntent('jugadoras que hayan jugado en la selección de España')
  assert(intent)
  assertEquals(intent!.country_tokens, ['España'])
})

Deno.test('ES: la selección argentina (adjective demonym)', () => {
  const intent = detectInternationalIntent('jugadoras de la selección argentina')
  assert(intent)
  assertEquals(intent!.country_tokens.map((c) => c.toLowerCase()), ['argentina'])
})

Deno.test('coaches with Olympic experience → tournament, no country', () => {
  const intent = detectInternationalIntent('coaches with Olympic experience')
  assert(intent)
  assertEquals(intent!.tournaments, ['olympics'])
  assertEquals(intent!.country_tokens, [])
})

Deno.test('Junior World Cup → tournament + junior level', () => {
  const intent = detectInternationalIntent('anyone who played a Junior World Cup')
  assert(intent)
  assert(intent!.tournaments.includes('junior_world_cup'))
  assertEquals(intent!.level, 'junior')
})

Deno.test('forwards who played Hockey One in Australia', () => {
  const intent = detectInternationalIntent('forwards who played Hockey One in Australia')
  assert(intent)
  assertEquals(intent!.tournaments, ['hockey_one'])
})

Deno.test('midfielders with EuroHockey experience', () => {
  const intent = detectInternationalIntent('midfielders with EuroHockey experience')
  assert(intent)
  assertEquals(intent!.tournaments, ['eurohockey'])
})

Deno.test('COEXISTENCE: Argentine defenders who played for the Spain national team', () => {
  const q = 'Argentine defenders who played for the Spain national team'
  const intent = detectInternationalIntent(q)
  assert(intent)
  assertEquals(intent!.country_tokens, ['Spain'])
  // Argentina (via the demonym stem) is asserted OUTSIDE the NT phrase →
  // stays a passport filter.
  assert(countryMentionedOutsideSpans(q, 'Argentina', intent!.spans))
  // Spain is only inside the NT phrase → moves out of nationalities.
  assertEquals(countryMentionedOutsideSpans(q, 'Spain', intent!.spans), false)
})

Deno.test('CONTROL: plain nationality query has NO intl intent', () => {
  assertEquals(detectInternationalIntent('players from Argentina'), null)
  assertEquals(detectInternationalIntent('Argentine midfielders in Spain'), null)
  assertEquals(detectInternationalIntent('find me 5 defenders'), null)
})

Deno.test('CONTROL: "team" alone is not an NT signal', () => {
  assertEquals(detectInternationalIntent('clubs with a strong first team'), null)
})

// ── Generic + phrasing variants ─────────────────────────────────────────

Deno.test('generic international experience → intent with no country', () => {
  const intent = detectInternationalIntent('players con experiencia internacional')
  assert(intent)
  assertEquals(intent!.country_tokens, [])
})

Deno.test('represented X / capped for X', () => {
  const a = detectInternationalIntent('players who represented Belgium')
  assert(a); assertEquals(a!.country_tokens, ['Belgium'])
  const b = detectInternationalIntent('midfielders capped for the Netherlands')
  assert(b); assertEquals(b!.country_tokens, ['Netherlands'])
})

Deno.test('ES: seleccionado de X / jugó un Mundial', () => {
  const a = detectInternationalIntent('jugó en el seleccionado de Uruguay')
  assert(a); assertEquals(a!.country_tokens, ['Uruguay'])
  const b = detectInternationalIntent('que hayan jugado un Mundial')
  assert(b); assert(b!.tournaments.includes('world_cup'))
})

Deno.test('U21 / senior level detection', () => {
  const j = detectInternationalIntent('played for the Argentina U21 national team')
  assert(j); assertEquals(j!.level, 'junior')
  const s = detectInternationalIntent('senior national team players from Spain')
  assert(s); assertEquals(s!.level, 'senior')
})

// ── Retrieval-side helpers ───────────────────────────────────────────────

Deno.test('row-level classification: junior + masters markers', () => {
  assertEquals(rowTextLevel('Multiple Argentina U19 national team training camps').junior, true)
  assertEquals(rowTextLevel('England Masters O35 IMC').masters, true)
  assertEquals(rowTextLevel('Italian National Team').junior, false)
  assertEquals(rowTextLevel('Italian National Team').masters, false)
})

Deno.test('tournament alias patterns include ES aliases', () => {
  const p = tournamentAliasPatterns(['world_cup'])
  assert(p.includes('%world cup%'))
  assert(p.includes('%mundial%'))
})

Deno.test('HIL cannot match inside an unrelated word', () => {
  assertEquals(detectInternationalIntent('players while abroad'), null)
})

// ── Router integration (incident #2's actual failure layer) ─────────────

import { classifyEntityType } from './intent-router.ts'

Deno.test('ROUTER: incident #2 query must NOT route to clubs', () => {
  const r = classifyEntityType('Are there any Argentina selection national team in the app?')
  assert(r.entity_type !== 'clubs', `routed to ${r.entity_type}`)
  assertEquals(r.entity_type, 'players')
  assert(r.matched_signals.includes('national_team'))
})

Deno.test('ROUTER: NT query with an explicit role noun keeps the role', () => {
  const r = classifyEntityType('coaches with Olympic experience who represented Ireland')
  assertEquals(r.entity_type, 'coaches')
})

Deno.test('ROUTER: ordinary team/club queries still route to clubs', () => {
  const r = classifyEntityType('find hockey clubs in Madrid')
  assertEquals(r.entity_type, 'clubs')
})

// ── Tier-7 domestic leagues need past/experience framing ─────────────────
// "players in the Bundesliga" is a CURRENT-league ask (existing league
// filter path) — it must NOT become a career-text restriction. Caught by a
// false-positive probe after the first prod ship.

Deno.test('CONTROL: bare domestic-league mentions do not trigger intl', () => {
  assertEquals(detectInternationalIntent('players in the Bundesliga'), null)
  assertEquals(detectInternationalIntent('midfielders currently playing in the Hoofdklasse'), null)
  assertEquals(detectInternationalIntent('clubs in the metropolitano'), null)
  assertEquals(detectInternationalIntent('defenders playing hockey one this season'), null)
})

Deno.test('past framing still triggers domestic-league experience', () => {
  const a = detectInternationalIntent('forwards who played Hockey One in Australia')
  assert(a); assertEquals(a!.tournaments, ['hockey_one'])
  const b = detectInternationalIntent('players with Bundesliga experience')
  assert(b); assertEquals(b!.tournaments, ['bundesliga_hockey'])
})

Deno.test('non-domestic tournaments stay ungated (no league path to break)', () => {
  const r = detectInternationalIntent('any Olympians here?')
  assert(r); assert(r!.tournaments.includes('olympics'))
})

// ── Word-boundary country matching (the prod-backfill bug class) ─────────

import { rowTextMatchesCountry } from './international-taxonomy.ts'

Deno.test('substring aliases cannot match inside words (us in Massachusetts)', () => {
  assertEquals(rowTextMatchesCountry('University of Massachusetts', ['us', 'usa', 'american']), false)
})

Deno.test('tournament adjectives cannot donate a country (Pan American Cup ≠ USA)', () => {
  assertEquals(rowTextMatchesCountry('2022 Pan American Cup', ['us', 'usa', 'american', 'united states']), false)
  // even without the year guard, blanking alone must hold:
  assertEquals(rowTextMatchesCountry('Pan American Cup squad', ['american']), false)
})

Deno.test('year-prefixed rows are events, never country matches', () => {
  assertEquals(rowTextMatchesCountry('2026 South African Series', ['south africa', 'south african']), false)
})

Deno.test('genuine national-team titles still match, word-bounded', () => {
  assertEquals(rowTextMatchesCountry('Italian National Team', ['italy', 'italian']), true)
  assertEquals(rowTextMatchesCountry('Selección Argentina', ['argentina', 'argentine']), true)
  assertEquals(rowTextMatchesCountry('England', ['england']), true)
  assertEquals(rowTextMatchesCountry("Lithuania’s national team", ['lithuania']), true)
  assertEquals(rowTextMatchesCountry('Team ARG', ['arg']), true)
})
