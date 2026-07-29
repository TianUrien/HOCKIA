/**
 * Deno tests for the suggested-actions catalog.
 *
 * Pins the deterministic behaviour so unintended drift surfaces immediately.
 * Run:  deno test supabase/functions/_shared/suggested-actions.test.ts --no-check
 */

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  type AppliedSearch,
  buildRoleSummary,
  getGreetingActions,
  getNoResultsActions,
  getRecoveryActions,
  getSelfAdviceActions,
  getSoftErrorActions,
} from './suggested-actions.ts'

// ── buildRoleSummary ───────────────────────────────────────────────────

Deno.test('buildRoleSummary: women + clubs + Spain', () => {
  const applied: AppliedSearch = {
    entity: 'clubs',
    gender_label: 'Women',
    location_label: 'Spain',
    role_summary: '', // computed below
  }
  assertEquals(buildRoleSummary(applied), "women's clubs in Spain")
})

Deno.test('buildRoleSummary: men + players + age range', () => {
  const applied: AppliedSearch = {
    entity: 'players',
    gender_label: 'Men',
    location_label: null,
    age: { max: 21 },
    role_summary: '',
  }
  assertEquals(buildRoleSummary(applied), "men's U22 players")
})

Deno.test('buildRoleSummary: bare entity, no filters', () => {
  const applied: AppliedSearch = {
    entity: 'coaches',
    gender_label: null,
    location_label: null,
    role_summary: '',
  }
  assertEquals(buildRoleSummary(applied), 'coaches')
})

Deno.test('buildRoleSummary: null applied → "profiles"', () => {
  assertEquals(buildRoleSummary(null), 'profiles')
})

// ── getNoResultsActions ────────────────────────────────────────────────

Deno.test('getNoResultsActions: player searching women clubs (the screenshot)', () => {
  const applied: AppliedSearch = {
    entity: 'clubs',
    gender_label: 'Women',
    location_label: null,
    role_summary: "women's clubs",
  }
  const actions = getNoResultsActions(applied, 'player')
  assertEquals(actions.length, 4)
  assertEquals(actions[0].label, 'Show all clubs')
  assertEquals(actions[1].label, 'Search by country')
  // Phase 3e renamed the category chips; 'Remove women filter' predates it.
  assertEquals(actions[2].label, 'Remove Adult Women filter')
  assertEquals(actions[3].label, 'Find opportunities')
})

Deno.test('getNoResultsActions: club searching players, no gender seeded', () => {
  const applied: AppliedSearch = {
    entity: 'players',
    gender_label: null,
    location_label: null,
    role_summary: 'players',
  }
  const actions = getNoResultsActions(applied, 'club')
  assertEquals(actions.length, 3) // no gender filter to remove
  assertEquals(actions[0].label, 'Show all players')
  assertEquals(actions[1].label, 'Search by country')
  assertEquals(actions[2].label, 'Find coaches') // cross-entity for club
})

Deno.test('getNoResultsActions: location already specified → no "search by country"', () => {
  const applied: AppliedSearch = {
    entity: 'clubs',
    gender_label: 'Women',
    location_label: 'Argentina',
    role_summary: "women's clubs in Argentina",
  }
  const actions = getNoResultsActions(applied, 'player')
  // Show all + Remove women + Find opportunities. No "Search by country".
  assertEquals(actions.length, 3)
  assertEquals(actions.some(a => a.label === 'Search by country'), false)
})

Deno.test('getNoResultsActions: brand searching players', () => {
  const applied: AppliedSearch = {
    entity: 'players',
    gender_label: null,
    location_label: null,
    role_summary: 'players',
  }
  const actions = getNoResultsActions(applied, 'brand')
  assertEquals(actions.some(a => a.label === 'Browse Marketplace'), true)
})

Deno.test('getNoResultsActions: unknown role still returns base chips', () => {
  const applied: AppliedSearch = {
    entity: 'clubs',
    gender_label: null,
    location_label: null,
    role_summary: 'clubs',
  }
  const actions = getNoResultsActions(applied, null)
  // Show all + Search by country, no cross-entity (unknown role)
  assertEquals(actions.length, 2)
})

Deno.test('getNoResultsActions: chip count never exceeds 4 (cap respected)', () => {
  const applied: AppliedSearch = {
    entity: 'clubs',
    gender_label: 'Women',
    location_label: null,
    role_summary: "women's clubs",
  }
  // player + clubs + women + no location → 4 chips, exactly the cap.
  const actions = getNoResultsActions(applied, 'player')
  assertEquals(actions.length, 4)
})

// ── getRecoveryActions ─────────────────────────────────────────────────

Deno.test('getRecoveryActions: rotates the leading chip', () => {
  const applied: AppliedSearch = {
    entity: 'clubs',
    gender_label: 'Women',
    location_label: null,
    role_summary: "women's clubs",
  }
  const initial = getNoResultsActions(applied, 'player')
  const recovery = getRecoveryActions(applied, 'player')
  // The first chip in recovery should be different from the first chip in the
  // initial pass — the user already saw "Show all clubs"; lead with country.
  assertEquals(recovery[0].label, initial[1].label)
  assertEquals(recovery[0].label !== initial[0].label, true)
})

Deno.test('getRecoveryActions: null applied falls through with clubs default', () => {
  // entity defaults to 'clubs'; no gender so 3 chips: Show all + Search by country + Find opportunities.
  // Rotation moves "Show all" to the end → leading chip is now "Search by country".
  const recovery = getRecoveryActions(null, 'player')
  assertEquals(recovery.length, 3)
  assertEquals(recovery[0].label, 'Search by country')
})

// ── getSoftErrorActions ────────────────────────────────────────────────

Deno.test('getSoftErrorActions: fixed 4 chips', () => {
  const actions = getSoftErrorActions()
  assertEquals(actions.length, 4)
  assertEquals(actions[0].label, 'Retry')
  assertEquals(actions[0].intent, { type: 'retry' })
  assertEquals(actions[3].label, 'Start over')
  assertEquals(actions[3].intent, { type: 'clear' })
})

// ── getSelfAdviceActions ───────────────────────────────────────────────

Deno.test('getSelfAdviceActions: player gets 3 role-aware chips', () => {
  const actions = getSelfAdviceActions('player')
  assertEquals(actions.length, 3)
  assertEquals(actions[0].label, 'Find clubs for me')
  assertEquals(actions[2].label, 'Improve my profile')
})

Deno.test('getSelfAdviceActions: coach', () => {
  const actions = getSelfAdviceActions('coach')
  assertEquals(actions.length, 3)
  assertEquals(actions[0].label, 'Find clubs hiring')
})

Deno.test('getSelfAdviceActions: club', () => {
  const actions = getSelfAdviceActions('club')
  assertEquals(actions.length, 3)
  assertEquals(actions[0].label, 'Find players for my team')
})

Deno.test('getSelfAdviceActions: brand', () => {
  const actions = getSelfAdviceActions('brand')
  assertEquals(actions.length, 3)
  assertEquals(actions[0].label, 'Find ambassadors')
})

Deno.test('getSelfAdviceActions: umpires get chips since Phase 4; unknown roles stay empty', () => {
  // The empty-umpire behaviour this test used to pin WAS the bug — Phase 4
  // gave umpires their own advice chips (see the case 'umpire' branch).
  assertEquals(getSelfAdviceActions('umpire').length, 3)
  assertEquals(getSelfAdviceActions(null).length, 0)
  assertEquals(getSelfAdviceActions('mystery').length, 0)
})

// ── getGreetingActions ─────────────────────────────────────────────────

Deno.test('getGreetingActions: single chip', () => {
  const actions = getGreetingActions()
  assertEquals(actions.length, 1)
  assertEquals(actions[0].label, 'What can you do?')
})

// ── Catalog invariants (chip-shape sanity) ─────────────────────────────

Deno.test('every chip label fits the 30-char display budget', () => {
  const allCatalogs: ReturnType<typeof getNoResultsActions>[] = [
    getNoResultsActions({ entity: 'clubs', gender_label: 'Women', location_label: null, role_summary: '' }, 'player'),
    getNoResultsActions({ entity: 'players', gender_label: null, location_label: null, role_summary: '' }, 'club'),
    getNoResultsActions({ entity: 'coaches', gender_label: null, location_label: null, role_summary: '' }, 'player'),
    getSoftErrorActions(),
    getSelfAdviceActions('player'),
    getSelfAdviceActions('coach'),
    getSelfAdviceActions('club'),
    getSelfAdviceActions('brand'),
    getGreetingActions(),
  ]
  for (const catalog of allCatalogs) {
    for (const chip of catalog) {
      if (chip.label.length > 30) {
        throw new Error(`Chip label exceeds 30 chars: "${chip.label}" (${chip.label.length})`)
      }
    }
  }
})

Deno.test('no chip label contains a question mark (chips are imperatives, not questions)', () => {
  const allCatalogs: ReturnType<typeof getNoResultsActions>[] = [
    getNoResultsActions({ entity: 'clubs', gender_label: 'Women', location_label: null, role_summary: '' }, 'player'),
    getSoftErrorActions(),
    getSelfAdviceActions('player'),
    getSelfAdviceActions('coach'),
    getSelfAdviceActions('club'),
    getSelfAdviceActions('brand'),
    // Greeting chip is the one exception — "What can you do?" is intentionally a question.
  ]
  for (const catalog of allCatalogs) {
    for (const chip of catalog) {
      if (chip.label.includes('?')) {
        throw new Error(`Chip label has a question mark: "${chip.label}"`)
      }
    }
  }
})
