import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { facts, lookingFor, stripPlaceholders, teamPhrase, template } from './role-description-copy.ts'

Deno.test('teamPhrase accepts the enum or the pill label', () => {
  assertEquals(teamPhrase('Men'), 'men’s team')
  assertEquals(teamPhrase("Men's"), 'men’s team')
  assertEquals(teamPhrase('Women’s'), 'women’s team')
  assertEquals(teamPhrase('Mixed'), 'mixed team')
  assertEquals(teamPhrase('Girls'), 'girls’ team')
  assertEquals(teamPhrase(''), null)
})

Deno.test('lookingFor never reads "a Men midfielder"', () => {
  assertEquals(lookingFor({ type: 'player', position: 'midfielder', team: 'Men' }), 'a midfielder for the men’s team')
  assertEquals(lookingFor({ type: 'coach', position: 'assistant_coach', team: 'Boys' }), 'an assistant coach for the boys’ team')
  assertEquals(lookingFor({ type: 'coach', position: null, team: null }), 'a coach')
})

Deno.test('template has no bracket placeholders and correct grammar', () => {
  const t = template({ type: 'player', position: 'midfielder', team: 'Men', city: 'Dublin', package: ['housing'] }, 'Test HC')
  assertStringIncludes(t, 'Test HC is looking for a midfielder for the men’s team, based in Dublin.')
  assertEquals(/\[/.test(t), false)
})

Deno.test('facts line reads naturally', () => {
  assertStringIncludes(facts({ type: 'player', position: 'midfielder', team: "Men's" }, 'Club', null).join('\n'), 'Looking for: a midfielder for the men’s team')
})

Deno.test('stripPlaceholders drops any sentence with a bracket prompt', () => {
  assertEquals(stripPlaceholders('We train hard. Sessions are on [training days]. Join us!'), 'We train hard. Join us!')
  assertEquals(stripPlaceholders('No brackets here.'), 'No brackets here.')
})
