import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cleanRoleText, validateRoleDraft, validStart } from './role-draft-from-text.ts'

const today = new Date('2026-10-18T10:00:00Z')

Deno.test('a left back sentence keeps only what the club said', () => {
  const d = validateRoleDraft({
    type: 'player', position: 'defender', team: 'Men', title: 'Left back', level: null,
    skills: [], start_date: '2027-01-01', duration: 'Full season', pay: 'paid', package: ['housing'],
    eu_passport: null, description: 'We’re looking for a left back for our men’s 1st team from January.',
  }, today)
  assertEquals(d.type, 'player')
  assertEquals(d.position, 'defender')
  assertEquals(d.team, 'Men')
  assertEquals(d.startDate, '2027-01-01')
  assertEquals(d.pay, 'paid')
  assertEquals(d.package, ['housing'])
  assertEquals(d.level, null)
  assertEquals(d.euPassport, false)
})

Deno.test('unknown values are dropped, never guessed', () => {
  const d = validateRoleDraft({ type: 'player', position: 'striker', team: 'Girls', pay: 'lots', package: ['yacht', 'car', 'car'], duration: '7', skills: ['sweeper_keeper'] }, today)
  assertEquals(d.position, null)
  assertEquals(d.team, null) // no under-18 player roles
  assertEquals(d.pay, null)
  assertEquals(d.package, ['car'])
  assertEquals(d.duration, null)
  assertEquals(d.skills, []) // sweeper keeper only for a goalkeeper
})

Deno.test('a coach role keeps coach teams and drops player-only fields', () => {
  const d = validateRoleDraft({ type: 'coach', position: 'head_coach', team: 'Girls', level: 'elite', skills: ['pressing'] }, today)
  assertEquals(d.position, 'head_coach')
  assertEquals(d.team, 'Girls')
  assertEquals(d.level, null)
  assertEquals(d.skills, [])
})

Deno.test('start dates must be real and within two years', () => {
  assertEquals(validStart('2027-01-01', today), '2027-01-01')
  assertEquals(validStart('2026-01-01', today), null)
  assertEquals(validStart('2029-01-01', today), null)
  assertEquals(validStart('2027-02-30', today), null)
  assertEquals(validStart('January', today), null)
})

Deno.test('descriptions with placeholders are dropped; garbage input is safe', () => {
  assertEquals(validateRoleDraft({ type: 'player', description: 'Training on [days] at our club.' }, today).description, '')
  const d = validateRoleDraft('nonsense', today)
  assertEquals(d.type, 'player')
  assertEquals(d.position, null)
  assertEquals(cleanRoleText('  a   b  '), 'a b')
  assertEquals(cleanRoleText(42), '')
})
