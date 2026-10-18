import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { stripClaims } from './role-ask.ts'

Deno.test('scores, rankings and promises are dropped; the rest stays', () => {
  assertEquals(stripClaims('You match the position. You are a 90% fit. You have an EU passport, which the role needs.'), 'You match the position. You have an EU passport, which the role needs.')
  assertEquals(stripClaims('Your chances are high. Ask the club about training days.'), 'Ask the club about training days.')
  assertEquals(stripClaims('You would definitely get it.'), '')
})
