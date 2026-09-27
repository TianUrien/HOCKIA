import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { facts, leagueForTeam, lookingFor, stripPlaceholders, teamPhrase, template } from './role-description-copy.ts'

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

Deno.test('leagueForTeam picks the league by the role team (pill label or enum)', () => {
  const men = 'Men Division 1'
  const women = 'Women Premier'
  assertEquals(leagueForTeam("Women's", men, women), women)
  assertEquals(leagueForTeam('Women’s', men, women), women)
  assertEquals(leagueForTeam('Women', men, women), women)
  assertEquals(leagueForTeam('Girls', men, women), women)
  assertEquals(leagueForTeam("Men's", men, women), men)
  assertEquals(leagueForTeam('Boys', men, women), men)
  // Never borrows the other side's league.
  assertEquals(leagueForTeam("Women's", men, null), null)
  assertEquals(leagueForTeam("Men's", null, women), null)
  // Mixed / no team: only when the club has a single league.
  assertEquals(leagueForTeam('Mixed', men, women), null)
  assertEquals(leagueForTeam('Mixed', null, women), women)
  assertEquals(leagueForTeam(null, men, '  '), men)
})
