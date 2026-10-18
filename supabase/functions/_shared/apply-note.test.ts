import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cleanNote, factLines, templateNote, type ApplyFacts, type RoleFacts } from './apply-note.ts'

const m: ApplyFacts = { firstName: 'Flor', role: 'player', position: 'defender', secondary: null, passports: [{ name: 'Spain', eu: true }, { name: 'Argentina', eu: false }], availableFrom: 'January 2027', currentClub: 'Club de Campo', career: [{ club: 'Banco Provincia', years: '2019 – 2022', league: 'Metro A' }], references: 2, hasVideo: true }
const r: RoleFacts = { club: 'Holcombe HC', title: 'Defender, men’s 1st team', position: 'defender', euRequired: true, city: 'London' }

Deno.test('facts list only what the profile has', () => {
  const f = factLines(m, r).join('\n')
  assertStringIncludes(f, 'Club: Holcombe HC')
  assertStringIncludes(f, 'The role needs an EU passport.')
  assertStringIncludes(f, 'Passports: Spain (EU), Argentina')
  assertStringIncludes(f, 'Available from: January 2027')
  assertEquals(factLines({ ...m, availableFrom: null, references: 0, hasVideo: false }, { ...r, euRequired: false }).join('\n').includes('Available'), false)
})

Deno.test('the template note is honest and short', () => {
  const t = templateNote(m, r)
  assertStringIncludes(t, 'Hi Holcombe HC,')
  assertStringIncludes(t, 'I’m a defender at Club de Campo')
  assertStringIncludes(t, 'EU passport (Spain)')
  assertStringIncludes(t, 'January 2027')
  assertEquals(templateNote({ ...m, position: null, currentClub: null, career: [], availableFrom: null }, { ...r, euRequired: false }), 'Hi Holcombe HC, I’d like to apply for Defender, men’s 1st team. Happy to share more about my hockey.')
})

Deno.test('model notes with placeholders or the wrong length are dropped', () => {
  assertEquals(cleanNote('Hi [Club], I am great.'), null)
  assertEquals(cleanNote('Hi'), null)
  assertEquals(cleanNote('"Hi Holcombe HC, I’m a defender and I’d like to apply for this role."'), 'Hi Holcombe HC, I’m a defender and I’d like to apply for this role.')
})
