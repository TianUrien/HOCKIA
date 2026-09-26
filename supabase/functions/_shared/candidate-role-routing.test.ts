/**
 * Candidate-side role seeking — staging audit 2026-09-26.
 *
 * A PLAYER asking Hockia AI for roles ("clubs looking for a midfielder in
 * Europe", "open roles for me", "midfielder roles with housing") was routed
 * to a PLAYER search and got nothing back. Once the viewer's role is known,
 * role-seeking queries from players (and coaches looking for work) must
 * route to open opportunities — without changing what recruiters get.
 */

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { classifyEntityType, isRoleSeekingQuery, routeForViewer } from './intent-router.ts'

const routed = (q: string, role: string | null) => routeForViewer(classifyEntityType(q), q, role)
const entity = (q: string, role: string | null) => routed(q, role).entity_type

// ── The reported queries (player viewer) ──────────────────────────────────
Deno.test('player: the founder audit queries route to opportunities', () => {
  for (const q of [
    'clubs looking for a midfielder in Europe',
    'open roles for me',
    'midfielder roles with housing',
    'Show me midfield roles open in Europe and clubs that need a midfielder',
  ]) {
    const r = routed(q, 'player')
    assertEquals(r.entity_type, 'opportunities', q)
    assertEquals(r.confidence, 'high', q)
  }
})

Deno.test('player: other role-seeking phrasings route to opportunities', () => {
  for (const q of [
    'Find opportunities for my position',
    'any trials in Spain?',
    'contracts in the Netherlands',
    'teams recruiting goalkeepers',
    "who's looking for a defender?",
    'where can I play next season',
    'vacancies in Argentina',
    'clubes que buscan delanteras',
  ]) {
    assertEquals(entity(q, 'player'), 'opportunities', q)
  }
})

Deno.test('player: people searches stay people searches', () => {
  assertEquals(entity('midfielders open to play', 'player'), 'players')
  assertEquals(entity('find players in Argentina', 'player'), 'players')
  assertEquals(entity('players looking for trials', 'player'), 'players')
  assertEquals(entity('Find coaches in my position', 'player'), 'coaches')
  assertEquals(entity('Find clubs for me', 'player'), 'clubs')
})

Deno.test('player: self / help intents are never hijacked', () => {
  assertEquals(entity('how do I apply to opportunities?', 'player'), 'platform_help')
  assertEquals(entity('what should I improve in my profile', 'player'), 'self_advice')
  assertEquals(entity('hi', 'player'), 'greeting')
})

// ── Recruiters are unchanged ──────────────────────────────────────────────
Deno.test('club: "looking for midfielders" still routes to players', () => {
  assertEquals(entity('looking for midfielders', 'club'), 'players')
  assertEquals(entity('find midfielders open to play', 'club'), 'players')
  assertEquals(isRoleSeekingQuery('looking for midfielders', 'club'), false)
})

Deno.test('club: "clubs looking for midfielders" keeps the named-entity rule', () => {
  assertEquals(entity('clubs looking for midfielders', 'club'), 'clubs')
})

Deno.test('brand / umpire / anonymous viewers never re-route', () => {
  assertEquals(isRoleSeekingQuery('open roles for me', 'brand'), false)
  assertEquals(isRoleSeekingQuery('open roles for me', 'umpire'), false)
  assertEquals(isRoleSeekingQuery('open roles for me', null), false)
})

// ── Coach: a candidate AND a recruiter ────────────────────────────────────
Deno.test('coach looking for work → opportunities', () => {
  assertEquals(entity('head coach roles in Europe', 'coach'), 'opportunities')
  assertEquals(entity('Find clubs hiring head coaches', 'coach'), 'opportunities')
  assertEquals(entity('Find opportunities for coaches', 'coach'), 'opportunities')
})

Deno.test('coach scouting players stays a people search', () => {
  assertEquals(entity('Find players for my staff', 'coach'), 'players')
  assertEquals(entity('looking for a goalkeeper', 'coach'), 'players')
  assertEquals(entity('clubs looking for midfielders', 'coach'), 'clubs')
})
