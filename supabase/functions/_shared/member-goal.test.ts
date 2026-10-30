import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { goalSummary } from './member-goal.ts'

Deno.test('goal summary: labels in order, own words last, unknown keys dropped', () => {
  assertEquals(goalSummary(['play_abroad', 'nope', 'get_sponsor'], null), 'Play abroad · Get a sponsor')
  assertEquals(goalSummary(['move_up'], '  Play in "Spain"\nnext year '), "Move up a division · Play in 'Spain' next year")
})

Deno.test('goal summary: nothing set is null', () => {
  assertEquals(goalSummary([], null), null)
  assertEquals(goalSummary(null, '   '), null)
})
