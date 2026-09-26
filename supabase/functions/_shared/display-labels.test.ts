import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { labelFor, scrubInternalValues } from './display-labels.ts'

Deno.test('labelFor maps internal enum values to human labels', () => {
  assertEquals(labelFor('adult_men'), "Men's")
  assertEquals(labelFor('adult_women'), "Women's")
  assertEquals(labelFor('open_to_opportunities'), 'Open to opportunities')
  assertEquals(labelFor('open_to_play'), 'Open to play')
  assertEquals(labelFor('head_coach'), 'Head coach')
  assertEquals(labelFor('strength_conditioning'), 'Strength & conditioning coach')
  assertEquals(labelFor('midfielder'), 'Midfielder')
})

Deno.test('labelFor de-underscores unknown snake_case and leaves plain text alone', () => {
  assertEquals(labelFor('some_new_value'), 'Some new value')
  assertEquals(labelFor('Spain'), 'Spain')
  assertEquals(labelFor(null), '')
})

Deno.test('scrubInternalValues removes raw enum values from model copy', () => {
  assertEquals(
    scrubInternalValues('I searched adult_men clubs that are open_to_opportunities.'),
    "I searched men's clubs that are open to opportunities.",
  )
  assertEquals(
    scrubInternalValues('Your target_category is adult_women; try head_coach roles.'),
    "Your target category is women's; try head coach roles.",
  )
})

Deno.test('scrubInternalValues keeps handles, paths, URLs and e-mails intact', () => {
  const s = 'Message @john_doe, open /dashboard/my_page or https://x.io/a_b, mail a_b@x.io'
  assertEquals(scrubInternalValues(s), s)
})

Deno.test('scrubInternalValues leaves ordinary copy unchanged', () => {
  const s = "I found 3 midfielder roles in Europe you can apply to."
  assertEquals(scrubInternalValues(s), s)
  assertEquals(scrubInternalValues(''), '')
})
