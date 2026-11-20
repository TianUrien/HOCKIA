import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { fitVerdict } from './opinion-verdict.ts'

Deno.test('fit verdict: within the cap it is returned as written', () => {
  assertEquals(fitVerdict('  This player matches your opening.  ', 280), 'This player matches your opening.')
  assertEquals(fitVerdict('One.\nTwo.', 280), 'One. Two.')
  assertEquals(fitVerdict('', 280), null)
  assertEquals(fitVerdict('   ', 280), null)
})

Deno.test('fit verdict: over the cap it keeps the whole sentences that fit', () => {
  const first = 'Her position matches your midfielder opening, and she is open to play now.'
  const second = ' Her league level is not on file, so tier fit against your side cannot be confirmed yet.'
  assertEquals(fitVerdict(first + second, 100), first)
  assertEquals(fitVerdict(first + second, first.length), first)
  // A decimal or an abbreviation inside a sentence is not a sentence end.
  assertEquals(fitVerdict('She played 3.5 seasons at this level. ' + 'x'.repeat(60) + '.', 50), 'She played 3.5 seasons at this level.')
  assertEquals(fitVerdict('She said "yes." Then more text follows here.', 20), 'She said "yes."')
})

Deno.test('fit verdict: refused when not even the first sentence fits', () => {
  assertEquals(fitVerdict('x'.repeat(300) + '.', 280), null)
  assertEquals(fitVerdict('no sentence end here ' + 'y'.repeat(300), 280), null)
})
