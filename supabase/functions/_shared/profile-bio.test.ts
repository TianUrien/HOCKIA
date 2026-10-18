import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { BIO_MAX, bioFactLines, validateBioDrafts, yearsSpan } from './profile-bio.ts'

Deno.test('bio facts: only what is set, career with years', () => {
  const lines = bioFactLines({ role: 'player', position: 'defender', secondary_position: null, playing_category: 'adult_women', base_location: 'Rome', nationalities: ['Argentina', 'Spain'], languages: [], open_to: ['new clubs'], career: [{ club: 'Lazio Hockey', league: 'Serie A', role: 'defender', years: '2022–present' }] })
  assertEquals(lines.includes('Category: adult women'), true)
  assertEquals(lines.includes('Languages'), false)
  assertEquals(lines.includes('Career: Lazio Hockey, Serie A, defender (2022–present)'), true)
})

Deno.test('bio drafts: contact details and claims are dropped, long ones cut on a sentence', () => {
  const long = `I play defence. ${'I love the game and train every day. '.repeat(30)}`
  const out = validateBioDrafts({ drafts: [
    { angle: 'Experience first', bio: 'I play for Lazio. Reach me at me@x.com' },
    { angle: 'Next', bio: 'Best player in Italy, guaranteed.' },
    { angle: 'Style', bio: long },
  ] })
  assertEquals(out.length, 0) // only the first two are read; both broke a rule
  const ok = validateBioDrafts({ drafts: [{ angle: 'Style', bio: long }, { angle: '', bio: 'I coach goalkeepers.' }] })
  assertEquals(ok.length, 2)
  assertEquals(ok[0].bio.length <= BIO_MAX, true)
  assertEquals(ok[0].bio.endsWith('.'), true)
  assertEquals(ok[1].angle, 'Another angle')
})

Deno.test('bio drafts: handles and phone numbers count as contact details', () => {
  assertEquals(validateBioDrafts({ drafts: [{ angle: 'a', bio: 'Follow me @hockeyfan on socials.' }] }).length, 0)
  assertEquals(validateBioDrafts({ drafts: [{ angle: 'a', bio: 'Call +54 11 5555 1234.' }] }).length, 0)
  assertEquals(validateBioDrafts({ drafts: [{ angle: 'a', bio: 'I played 2019–2023 in Serie A.' }] }).length, 1)
  assertEquals(validateBioDrafts({ drafts: [{ angle: 'a', bio: 'I played for Lazio (2019-2023) and Roma (2023-present).' }] }).length, 1)
  assertEquals(validateBioDrafts({ drafts: [{ angle: 'a', bio: 'Seasons 2019/20, 2020/21 and 2021/22 in the top flight.' }] }).length, 1)
  assertEquals(validateBioDrafts({ drafts: [{ angle: 'a', bio: 'WhatsApp 011 4555 1234 me.' }] }).length, 0)
})

Deno.test('years span', () => {
  assertEquals(yearsSpan('2019-08-01', '2023-05-01'), '2019–2023')
  assertEquals(yearsSpan('2022-01-01', null), '2022–present')
  assertEquals(yearsSpan(null, null), 'dates not given')
})

Deno.test('bio drafts: flat tool fields, recommended first; junk gives none', () => {
  const out = validateBioDrafts({ recommended_angle: 'Experience first', recommended_bio: 'I play for Lazio.', other_angle: 'Next move', other_bio: 'I want to play in Spain.' })
  assertEquals(out.map((d) => d.angle), ['Experience first', 'Next move'])
  assertEquals(validateBioDrafts({ recommended_bio: 'I coach goalkeepers.' }).length, 1)
  assertEquals(validateBioDrafts({ drafts: 'not json' }).length, 0)
  assertEquals(validateBioDrafts(null).length, 0)
})
