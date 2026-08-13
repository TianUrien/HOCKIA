/**
 * Role-aware filter scoping — regression for the 2026-08-08 Discovery bug.
 *
 * "Show all clubs" returned 0 while the NARROWER "clubs looking for forwards
 * or midfielders" returned 14. The parse for the broad query carried
 * positions bled from the previous turn, and a position is a player
 * attribute — 0 of 27 club profiles on prod have one — so a club search
 * carrying it can only ever return nothing.
 */

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { scopeFiltersToRoles } from './role-filter-scope.ts'

const FULL = {
  p_positions: ['forward', 'midfielder'],
  p_min_age: 18,
  p_max_age: 30,
  p_coach_specializations: ['goalkeeping'],
  p_target_category: 'adult_men',
  p_gender: 'male',
  p_specialist_skills: ['drag_flick'],
  p_level_target: 'elite',
  p_relocation_willingness: 'open',
  // Geography + text apply to organisations too — must SURVIVE.
  p_country_ids: [11],
  p_base_country_ids: [11],
  p_base_location: 'Buenos Aires',
  p_search_text: 'hockey',
  p_league_ids: [3],
}

Deno.test('club search drops player-only filters (the reported bug)', () => {
  const { params, dropped } = scopeFiltersToRoles(FULL, ['club'])
  assertEquals(params.p_positions, null, 'a position can never match a club')
  assertEquals(params.p_min_age, null)
  assertEquals(params.p_target_category, null)
  assertEquals(params.p_coach_specializations, null)
  assertEquals(dropped.includes('p_positions'), true)
})

Deno.test('club search KEEPS geography and text — clubs do have those', () => {
  const { params } = scopeFiltersToRoles(FULL, ['club'])
  assertEquals(params.p_country_ids, [11])
  assertEquals(params.p_base_country_ids, [11])
  assertEquals(params.p_base_location, 'Buenos Aires')
  assertEquals(params.p_search_text, 'hockey')
  assertEquals(params.p_league_ids, [3])
})

Deno.test('player search keeps everything player-related', () => {
  const { params, dropped } = scopeFiltersToRoles(FULL, ['player'])
  assertEquals(params.p_positions, ['forward', 'midfielder'])
  assertEquals(params.p_min_age, 18)
  assertEquals(params.p_target_category, 'adult_men')
  // coach-only still goes
  assertEquals(params.p_coach_specializations, null)
  assertEquals(dropped, ['p_coach_specializations'])
})

Deno.test('coach search keeps coach specializations and category, drops positions', () => {
  const { params } = scopeFiltersToRoles(FULL, ['coach'])
  assertEquals(params.p_coach_specializations, ['goalkeeping'])
  assertEquals(params.p_target_category, 'adult_men', 'coaches have coaching_categories')
  assertEquals(params.p_positions, null)
})

Deno.test('MIXED player+club keeps positions — the player half can still match', () => {
  const { params } = scopeFiltersToRoles(FULL, ['player', 'club'])
  assertEquals(params.p_positions, ['forward', 'midfielder'])
  assertEquals(params.p_target_category, 'adult_men')
})

Deno.test('brand search drops every person attribute', () => {
  const { params } = scopeFiltersToRoles(FULL, ['brand'])
  assertEquals(params.p_positions, null)
  assertEquals(params.p_target_category, null)
  assertEquals(params.p_coach_specializations, null)
  assertEquals(params.p_base_location, 'Buenos Aires', 'brands still have a location')
})

Deno.test('nulls are not reported as dropped (no phantom telemetry)', () => {
  const { dropped } = scopeFiltersToRoles(
    { p_positions: null, p_min_age: null, p_base_location: 'Madrid' },
    ['club'],
  )
  assertEquals(dropped, [])
})

Deno.test('empty roles defaults to player and changes nothing player-ish', () => {
  const { params } = scopeFiltersToRoles(FULL, [])
  assertEquals(params.p_positions, ['forward', 'midfielder'])
})

Deno.test('input object is not mutated', () => {
  const input = { ...FULL }
  scopeFiltersToRoles(input, ['club'])
  assertEquals(input.p_positions, ['forward', 'midfielder'])
})
