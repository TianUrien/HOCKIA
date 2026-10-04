import { assert, assertEquals, assertFalse, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  PRIVATE_KEYS,
  REFINE_FALLBACK,
  REFINE_MODE,
  REFINE_SYSTEM_PROMPT,
  REFINE_TOOL,
  buildRefineCandidates,
  buildRefineUserMessage,
  isUuid,
  normalizeRefineResult,
} from './role-suggestions-refine.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const countries = [
  { id: 1, name: 'Italy', common_name: 'Italy' },
  { id: 2, name: 'Argentine Republic', common_name: 'Argentina' },
]

function payload(extra: Record<string, unknown> = {}) {
  return {
    role: { id: 'r1', title: 'Midfielder · Men’s 1st', position: 'midfielder', gender: 'Men', eu_passport_required: true, start_date: '2027-01-10' },
    computed_at: '2026-10-04T03:30:00Z',
    suggestions: [
      {
        rank: 1, player_id: A, full_name: 'Mattia Amorosini', role: 'player', position: 'midfielder', secondary_position: 'forward',
        nationality_country_id: 1, nationality2_country_id: null, fit_state: 'green',
        evidence: { eu_passport: true, playing_category: 'adult_men', league_name: 'Serie A Elite', full_matches: 0, highlights: 2, career_entries: 3, references: 1, active_30d: true },
        ...extra,
      },
      {
        rank: 2, player_id: B, full_name: 'Santiago Puglisi', role: 'player', position: 'forward', secondary_position: 'midfielder',
        nationality_country_id: 2, nationality2_country_id: 1, fit_state: 'yellow',
        evidence: { eu_passport: true, available_from: '2027-01-01', league_name: 'Serie A1', league_self_reported: true, full_matches: 1 },
      },
      {
        rank: 3, player_id: C, full_name: 'Facundo Diaz', role: 'player', position: 'midfielder', secondary_position: null,
        nationality_country_id: 2, nationality2_country_id: null, fit_state: 'green',
        evidence: { eu_passport: false, full_matches: 2 },
      },
    ],
  }
}

Deno.test('mode name is stable (client contract)', () => {
  assertEquals(REFINE_MODE, 'role_suggestions_refine')
})

Deno.test('buildRefineCandidates: refs P1..Pn, public facts only, country names resolved', () => {
  const built = buildRefineCandidates(payload(), countries)!
  assertEquals(built.candidates.map((c) => c.ref), ['P1', 'P2', 'P3'])
  assertEquals(built.candidates[1].nationalities, ['Argentina', 'Italy'])
  assertEquals(built.candidates[0].positions, ['Midfielder', 'Forward'])
  assertEquals(built.candidates[0].category, "Men's")
  assertEquals(built.candidates[0].fit, 'Strong fit')
  assertEquals(built.candidates[1].fit, 'Possible fit')
  assertEquals(built.role.eu_passport_required, true)
})

Deno.test('buildRefineCandidates: private keys in the payload never reach the prompt', () => {
  const leaky = payload({ date_of_birth: '2001-02-03', email: 'x@example.com', phone: '+100', age: 25 })
  ;(leaky.suggestions[0].evidence as Record<string, unknown>).date_of_birth = '2001-02-03'
  const built = buildRefineCandidates(leaky, countries)!
  const msg = buildRefineUserMessage('EU passport?', built.role, built.candidates)
  for (const k of PRIVATE_KEYS) assertFalse(JSON.stringify(built.candidates).includes(`"${k}"`), k)
  assertFalse(msg.includes('2001-02-03'))
  assertFalse(msg.includes('x@example.com'))
  assertFalse(msg.includes('+100'))
})

Deno.test('buildRefineCandidates: ids never appear in the prompt; at most 5 candidates', () => {
  const many = payload()
  many.suggestions = Array.from({ length: 8 }, (_, i) => ({ ...many.suggestions[0], player_id: `${i}1111111-1111-4111-8111-111111111111`, rank: i + 1 }))
  const built = buildRefineCandidates(many, countries)!
  assertEquals(built.candidates.length, 5)
  const msg = buildRefineUserMessage('Who has highlights?', built.role, built.candidates)
  assertFalse(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(msg))
})

Deno.test('buildRefineCandidates: null / non-owner payload → null', () => {
  assertEquals(buildRefineCandidates(null, countries), null)
  assertEquals(buildRefineCandidates({ suggestions: [] }, countries), null)
})

Deno.test('user message states missing facts as "not on the profile"', () => {
  const built = buildRefineCandidates(payload(), countries)!
  const msg = buildRefineUserMessage('start in January', built.role, built.candidates)
  assertStringIncludes(msg, 'P3 · Facundo Diaz')
  assertStringIncludes(msg, 'EU passport: not on the profile')
  assertStringIncludes(msg, 'start date: not on the profile')
  assertStringIncludes(msg, 'available from: 2027-01-01')
  assertStringIncludes(msg, 'league: Serie A1 (self-reported)')
  assertStringIncludes(msg, 'EU passport required: yes')
})

Deno.test('system prompt: facts only, say what cannot be confirmed, gender-neutral, no ranking talk', () => {
  assertStringIncludes(REFINE_SYSTEM_PROMPT, 'ONLY the listed facts')
  assertStringIncludes(REFINE_SYSTEM_PROMPT, "CAN'T confirm")
  assertStringIncludes(REFINE_SYSTEM_PROMPT, 'Gender-neutral')
  assertStringIncludes(REFINE_SYSTEM_PROMPT, 'Never add anyone who is not listed')
  assertEquals(REFINE_TOOL.input_schema.required, ['answer', 'matches'])
})

Deno.test('normalizeRefineResult: refs map to the stored ids only, in the model order, deduped', () => {
  const { candidates } = buildRefineCandidates(payload(), countries)!
  const out = normalizeRefineResult({ answer: 'Mattia and Santiago hold an EU passport.', matches: ['P2', 'p1', 'P2', 'P9', 'someone'] }, candidates, REFINE_FALLBACK)
  assertEquals(out.match_ids, [B, A])
})

Deno.test('normalizeRefineResult: refs in the text become names; ids and markdown are stripped', () => {
  const { candidates } = buildRefineCandidates(payload(), countries)!
  const out = normalizeRefineResult({ answer: `**P1** has a passport (${A}).`, matches: [] }, candidates, REFINE_FALLBACK)
  assertStringIncludes(out.answer, 'Mattia Amorosini has a passport')
  assertFalse(out.answer.includes(A))
  assertFalse(out.answer.includes('*'))
})

Deno.test('normalizeRefineResult: ranking sentences and gendered pronouns are dropped', () => {
  const { candidates } = buildRefineCandidates(payload(), countries)!
  const out = normalizeRefineResult({
    answer: 'Mattia holds an EU passport. He is ranked first. Neither profile shows a start date, so ask them.',
    matches: ['P1'],
  }, candidates, REFINE_FALLBACK)
  assertEquals(out.answer, 'Mattia holds an EU passport. Neither profile shows a start date, so ask them.')
})

Deno.test('normalizeRefineResult: empty or unusable answer → fallback; chips capped and cleaned', () => {
  const { candidates } = buildRefineCandidates(payload(), countries)!
  const out = normalizeRefineResult({
    answer: '',
    matches: [],
    chips: ['Include forwards', 'Drag flickers only', 'Include forwards', 'A chip that is far too long to fit on a phone row', 'P1 only', 'Ask her'],
  }, candidates, REFINE_FALLBACK)
  assertEquals(out.answer, REFINE_FALLBACK)
  assertEquals(out.chips, ['Include forwards', 'Drag flickers only'])
  assert(out.chips.length <= 3)
})

Deno.test('normalizeRefineResult: garbage input never throws', () => {
  const { candidates } = buildRefineCandidates(payload(), countries)!
  assertEquals(normalizeRefineResult(undefined, candidates, REFINE_FALLBACK).match_ids, [])
  assertEquals(normalizeRefineResult('x', candidates, REFINE_FALLBACK).answer, REFINE_FALLBACK)
})

Deno.test('normalizeRefineResult: long answers are capped', () => {
  const { candidates } = buildRefineCandidates(payload(), countries)!
  const out = normalizeRefineResult({ answer: 'Mattia plays midfield. '.repeat(60), matches: [] }, candidates, REFINE_FALLBACK)
  assert(out.answer.length <= 600)
})

Deno.test('isUuid', () => {
  assert(isUuid(A))
  assertFalse(isUuid('nope'))
  assertFalse(isUuid(null))
})
