/**
 * Intent-router recruiting rule — founder ruling, 2026-08-13.
 *
 * "Show me clubs looking for forwards or midfielders" used to route to
 * PLAYERS: the rule sent recruitment-style queries to the role being
 * recruited, ignoring the entity the user had explicitly named. On prod that
 * returned 124 player cards under a summary reading "Showing clubs with open
 * opportunities for forwards or midfielders" — the copy and the grid
 * contradicting each other.
 *
 * The rule now is: whatever entity is named BEFORE the recruiting verb wins.
 * The recruited role only wins when the user named nothing there.
 */

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { classifyEntityType, hasRecruitingIntent } from './intent-router.ts'

const t = (q: string) => classifyEntityType(q).entity_type

// ── The reported bug ──────────────────────────────────────────────────────
Deno.test('"clubs looking for forwards" returns CLUBS, not forwards', () => {
  assertEquals(t('Show me clubs looking for forwards or midfielders'), 'clubs')
  assertEquals(t('clubs looking for forwards'), 'clubs')
  assertEquals(t('Show me clubs looking for forwards or midfielders in Argentina'), 'clubs')
})

Deno.test('the named entity wins across the recruiting verb set', () => {
  assertEquals(t('clubs hiring midfielders'), 'clubs')
  assertEquals(t('teams recruiting defenders'), 'clubs')
  assertEquals(t('clubs seeking forwards'), 'clubs')
  assertEquals(t('clubs in need of a goalkeeper'), 'clubs')
})

Deno.test('the inverted case the old rule documented', () => {
  // Was 'coaches' — the user said "clubs", so clubs it is.
  assertEquals(t('find clubs hiring coaches'), 'clubs')
})

// ── What the rule was really written for — must still work ────────────────
Deno.test('no entity named before the verb → the RECRUITED role wins', () => {
  assertEquals(t('who is looking for midfielders'), 'players')
  assertEquals(t('looking for a goalkeeper'), 'players')
  assertEquals(t('hiring coaches'), 'coaches')
  assertEquals(t('recruiting defenders'), 'players')
})

// ── No regressions on queries that already worked ─────────────────────────
Deno.test('person-first recruiting queries are unchanged', () => {
  assertEquals(t('players looking for clubs'), 'players')
  assertEquals(t('coaches looking for a new club'), 'coaches')
  assertEquals(t('umpires looking for appointments'), 'umpires')
})

Deno.test('non-recruiting queries are untouched', () => {
  assertEquals(t('Show all clubs'), 'clubs')
  assertEquals(t('find hockey clubs in Madrid'), 'clubs')
  assertEquals(t('Show me midfielders under 25'), 'players')
  assertEquals(t('Show me coaches'), 'coaches')
  assertEquals(t('Show me umpires'), 'umpires')
})

Deno.test('two entities before the verb is ambiguous → verb anchoring decides', () => {
  // "find COACHES at clubs hiring players" — the imperative object wins.
  assertEquals(t('find coaches at clubs hiring players'), 'coaches')
})

// ── The shared predicate nl-search reads ──────────────────────────────────
Deno.test('hasRecruitingIntent gates the vacancy lookup', () => {
  assertEquals(hasRecruitingIntent('Show me clubs looking for forwards'), true)
  assertEquals(hasRecruitingIntent('clubs hiring midfielders'), true)
  assertEquals(hasRecruitingIntent('clubs seeking forwards'), true)
  // The bleed case: positions carried over from a previous turn must NOT be
  // reinterpreted as a vacancy filter — they get dropped instead.
  assertEquals(hasRecruitingIntent('Show all clubs'), false)
  assertEquals(hasRecruitingIntent('What clubs would suit me?'), false)
  assertEquals(hasRecruitingIntent(''), false)
})
