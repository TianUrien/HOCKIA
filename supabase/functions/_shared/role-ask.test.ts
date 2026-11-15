import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { SHORT_ANSWER_MAX_TOKENS, readShortAnswer, stripClaims } from './role-ask.ts'

Deno.test('scores, rankings and promises are dropped; the rest stays', () => {
  assertEquals(stripClaims('You match the position. You are a 90% fit. You have an EU passport, which the role needs.'), 'You match the position. You have an EU passport, which the role needs.')
  assertEquals(stripClaims('Your chances are high. Ask the club about training days.'), 'Ask the club about training days.')
  assertEquals(stripClaims('You would definitely get it.'), '')
})

Deno.test('a reply the token cap ended before any text is a failure, not "I don\'t know"', () => {
  // What the API returns when the model's reasoning used the whole cap.
  assertEquals(readShortAnswer({ content: [{ type: 'thinking' }], stop_reason: 'max_tokens' }), { text: '', cutOff: true })
  assertEquals(readShortAnswer({ content: [], stop_reason: 'max_tokens' }), { text: '', cutOff: true })
})

Deno.test('text is read past reasoning blocks, and a cut-off answer with text is still used', () => {
  assertEquals(readShortAnswer({ content: [{ type: 'thinking' }, { type: 'text', text: 'You match the position.' }], stop_reason: 'end_turn' }), { text: 'You match the position.', cutOff: false })
  assertEquals(readShortAnswer({ content: [{ type: 'text', text: 'You match the position. Your pass' }], stop_reason: 'max_tokens' }), { text: 'You match the position. Your pass', cutOff: false })
  // Every sentence stripped is not a cut-off: the caller's own fallback applies.
  assertEquals(readShortAnswer({ content: [{ type: 'text', text: 'You would definitely get it.' }], stop_reason: 'end_turn' }), { text: '', cutOff: false })
})

Deno.test('the cap leaves room for reasoning as well as a short answer', () => {
  assertEquals(SHORT_ANSWER_MAX_TOKENS >= 1500, true)
})
