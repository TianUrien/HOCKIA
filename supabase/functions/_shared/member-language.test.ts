import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  LANGUAGE_READ_CHUNK,
  languageOf,
  emailPositionLabel,
  readMemberLanguage,
  readMemberLanguages,
  relationshipLabel,
  roleLabel,
  spanishPositionLabel,
} from './member-language.ts'

type Row = { id: string; ui_language: string | null }
type Result = { data: unknown; error: { message: string } | null }

/** Fake PostgREST client over a profiles table; `fail` makes every read error, `throws` makes it throw. */
function fakeClient(rows: Row[], opts: { fail?: boolean; throws?: boolean } = {}) {
  const calls: string[][] = []
  const result = (data: unknown): Result =>
    opts.fail ? { data: null, error: { message: 'column profiles.ui_language does not exist' } } : { data, error: null }
  return {
    calls,
    from(table: string) {
      assertEquals(table, 'profiles')
      return {
        select(_cols: string) {
          return {
            eq(_col: string, id: string) {
              return {
                maybeSingle(): Promise<Result> {
                  if (opts.throws) return Promise.reject(new Error('network'))
                  return Promise.resolve(result(rows.find(r => r.id === id) ?? null))
                },
              }
            },
            in(_col: string, ids: string[]): Promise<Result> {
              calls.push(ids)
              if (opts.throws) return Promise.reject(new Error('network'))
              return Promise.resolve(result(rows.filter(r => ids.includes(r.id))))
            },
          }
        },
      }
    },
  }
}

Deno.test('languageOf: only "es" is Spanish', () => {
  assertEquals(languageOf('es'), 'es')
  assertEquals(languageOf('en'), 'en')
  assertEquals(languageOf(null), 'en')
  assertEquals(languageOf(undefined), 'en')
  assertEquals(languageOf('ES'), 'en')
  assertEquals(languageOf('fr'), 'en')
})

Deno.test('readMemberLanguage reads the stored value', async () => {
  const c = fakeClient([{ id: 'a', ui_language: 'es' }, { id: 'b', ui_language: null }])
  assertEquals(await readMemberLanguage(c, 'a'), 'es')
  assertEquals(await readMemberLanguage(c, 'b'), 'en')
  assertEquals(await readMemberLanguage(c, 'missing'), 'en')
  assertEquals(await readMemberLanguage(c, null), 'en')
})

Deno.test('readMemberLanguage fails to English on error or throw', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    assertEquals(await readMemberLanguage(fakeClient([{ id: 'a', ui_language: 'es' }], { fail: true }), 'a'), 'en')
    assertEquals(await readMemberLanguage(fakeClient([{ id: 'a', ui_language: 'es' }], { throws: true }), 'a'), 'en')
  } finally {
    console.warn = warn
  }
})

Deno.test('readMemberLanguages: every id present, missing ones English, chunked', async () => {
  const rows: Row[] = []
  const ids: string[] = []
  for (let i = 0; i < LANGUAGE_READ_CHUNK * 2 + 5; i++) {
    ids.push(`p${i}`)
    if (i % 3 === 0) rows.push({ id: `p${i}`, ui_language: 'es' })
  }
  ids.push('p0') // duplicate
  const c = fakeClient(rows)
  const map = await readMemberLanguages(c, ids)
  assertEquals(map.size, LANGUAGE_READ_CHUNK * 2 + 5)
  assertEquals(map.get('p0'), 'es')
  assertEquals(map.get('p1'), 'en')
  assertEquals(map.get('p3'), 'es')
  assertEquals(c.calls.length, 3)
  assertEquals(c.calls.every(chunk => chunk.length <= LANGUAGE_READ_CHUNK), true)
})

Deno.test('readMemberLanguages fails to English on error or throw', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    for (const opts of [{ fail: true }, { throws: true }]) {
      const map = await readMemberLanguages(fakeClient([{ id: 'a', ui_language: 'es' }], opts), ['a', 'b'])
      assertEquals([...map.entries()], [['a', 'en'], ['b', 'en']])
    }
    assertEquals((await readMemberLanguages(fakeClient([]), [])).size, 0)
  } finally {
    console.warn = warn
  }
})

Deno.test('emailPositionLabel / roleLabel: English capitalises, Spanish uses the agreed words', () => {
  assertEquals(emailPositionLabel('midfielder'), 'Midfielder')
  assertEquals(emailPositionLabel('midfielder', 'es'), 'Volante')
  assertEquals(emailPositionLabel('goalkeeper', 'es'), 'Arquero/a')
  assertEquals(emailPositionLabel('defender', 'es'), 'Defensor/a')
  assertEquals(emailPositionLabel('forward', 'es'), 'Delantero/a')
  assertEquals(emailPositionLabel('sweeper', 'es'), 'Sweeper')
  assertEquals(roleLabel('coach'), 'Coach')
  assertEquals(roleLabel('coach', 'es'), 'Entrenador/a')
  assertEquals(roleLabel('umpire', 'es'), 'Árbitro/a')
  assertEquals(roleLabel('player', 'es'), 'Jugador/a')
})

Deno.test('spanishPositionLabel covers coach specialisations; relationshipLabel keeps English and unknowns', () => {
  assertEquals(spanishPositionLabel('head_coach'), 'Entrenador/a principal')
  assertEquals(spanishPositionLabel('unknown'), null)
  assertEquals(spanishPositionLabel(null), null)
  assertEquals(relationshipLabel('Teammate'), 'Teammate')
  assertEquals(relationshipLabel('Teammate', 'es'), 'Compañero/a de equipo')
  assertEquals(relationshipLabel('Former Coach', 'es'), 'Ex entrenador/a')
  assertEquals(relationshipLabel('Something new', 'es'), 'Something new')
  assertEquals(relationshipLabel(null, 'es'), '')
})
