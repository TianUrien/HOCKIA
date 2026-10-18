/**
 * Deno tests for clarifying-question detection.
 *
 * Run:  deno test supabase/functions/_shared/clarifying.test.ts --no-check
 */

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { detectClarifyingNeed } from './clarifying.ts'

// ── Should match (vague queries) ───────────────────────────────────────

const POSITIVE = [
  'Find people',
  'Find someone',
  'find anyone',
  'Show me options',
  'show options',
  'Show me recommendations',
  'Who can help me?',
  'Who should I talk to?',
  'Who could help me',
  'Any recommendations?',
  'any suggestions',
  'recommendations',
  'tips',
  'Search hockey',
  'Browse the platform',
  'browse hockia',
  'explore profiles',
]

for (const q of POSITIVE) {
  Deno.test(`detectClarifyingNeed: matches "${q}"`, () => {
    const result = detectClarifyingNeed(q, 'player')
    if (!result) throw new Error(`Expected clarifying for "${q}" but got null`)
    assertEquals(result.message, 'Who would you like to look for?')
    assertEquals(result.options.length, 4)
  })
}

// ── Should NOT match (specific or substantive queries) ─────────────────

const NEGATIVE = [
  // Specific entity searches → keyword router handles, no clarifying needed
  'Find clubs for me',
  'Find players in Spain',
  'show me coaches',
  'find U21 defenders',
  'Find player ambassadors',

  // Recovery follow-ups → recovery short-circuit handles
  'what should I do?',
  'so what now?',
  'and?',
  'help',
  'ok',
  'any other ideas?',  // recovery, not vague-search

  // Substantive questions → LLM
  "What about Argentinian players?",
  'How do I improve my profile?',
  'What is a penalty corner?',

  // Empty / whitespace
  '',
  '   ',

  // Long-form queries
  "I'd really like to know who you would recommend I look for to improve my chances of getting noticed",
]

for (const q of NEGATIVE) {
  Deno.test(`detectClarifyingNeed: does NOT match "${q}"`, () => {
    const result = detectClarifyingNeed(q, 'player')
    assertEquals(result, null)
  })
}

// ── Role-aware option sets ─────────────────────────────────────────────

Deno.test('clarifying options: player gets Opportunities (recommended) / Clubs / Coaches / Brands', () => {
  const result = detectClarifyingNeed('Find people', 'player')
  if (!result) throw new Error('expected match')
  const labels = result.options.map(o => o.label)
  assertEquals(labels, ['Opportunities', 'Clubs', 'Coaches', 'Brands'])
  assertEquals(result.options[0].recommended, true)
  assertEquals(result.options.filter(o => o.recommended).length, 1)
})

Deno.test('clarifying options: club gets Players/Coaches/Opportunities/Brands', () => {
  const result = detectClarifyingNeed('Find people', 'club')
  if (!result) throw new Error('expected match')
  const labels = result.options.map(o => o.label)
  assertEquals(labels[0], 'Players')
  assertEquals(labels.length, 4)
})

Deno.test('clarifying options: brand gets ambassadors / clubs / coaches / marketplace', () => {
  const result = detectClarifyingNeed('Find people', 'brand')
  if (!result) throw new Error('expected match')
  const labels = result.options.map(o => o.label)
  assertEquals(labels[0], 'Player ambassadors')
  assertEquals(labels[3], 'Marketplace')
})

Deno.test('clarifying options: null role gets the four core entity types', () => {
  const result = detectClarifyingNeed('Find people', null)
  if (!result) throw new Error('expected match')
  const labels = result.options.map(o => o.label)
  assertEquals(labels, ['Clubs', 'Players', 'Coaches', 'Opportunities'])
})

Deno.test('clarifying options: every routed_query is a complete sentence', () => {
  for (const role of ['player', 'coach', 'club', 'brand', null]) {
    const result = detectClarifyingNeed('Find people', role)
    if (!result) throw new Error('expected match')
    for (const opt of result.options) {
      if (opt.routed_query.length < 5) {
        throw new Error(`routed_query too short for ${role}/${opt.label}: "${opt.routed_query}"`)
      }
    }
  }
})
