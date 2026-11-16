// Stage 3: the Hockia AI language helper (body locale > profile > English).
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  bodyLocale,
  currentAiLanguage,
  inCurrentLanguage,
  pick,
  resolveAiLanguage,
  runWithAiLanguage,
  setCurrentAiLanguage,
  spanishMonthYear,
  SPANISH_OUTPUT_INSTRUCTION,
  withOutputLanguage,
} from './ai-language.ts'

/** A client whose profiles read returns `uiLanguage`, an error, or throws. */
function client(opts: { uiLanguage?: unknown; error?: boolean; throws?: boolean }) {
  const calls: string[] = []
  return {
    calls,
    from(table: string) {
      calls.push(table)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              if (opts.throws) throw new Error('network')
              if (opts.error) return Promise.resolve({ data: null, error: { message: 'column does not exist' } })
              return Promise.resolve({ data: { ui_language: opts.uiLanguage ?? null }, error: null })
            },
          }),
        }),
      }
    },
  }
}

Deno.test('bodyLocale reads en / es (and region tags); anything else is null', () => {
  assertEquals(bodyLocale({ locale: 'es' }), 'es')
  assertEquals(bodyLocale({ locale: 'es-AR' }), 'es')
  assertEquals(bodyLocale({ locale: 'EN' }), 'en')
  assertEquals(bodyLocale({ locale: 'fr' }), null)
  assertEquals(bodyLocale({ locale: 3 }), null)
  assertEquals(bodyLocale({}), null)
  assertEquals(bodyLocale(null), null)
  assertEquals(bodyLocale('es'), null)
})

Deno.test('resolveAiLanguage: the body locale wins over the profile, without a read', async () => {
  const c = client({ uiLanguage: 'en' })
  assertEquals(await resolveAiLanguage(c, 'u1', { locale: 'es' }), 'es')
  const c2 = client({ uiLanguage: 'es' })
  assertEquals(await resolveAiLanguage(c2, 'u1', { locale: 'en' }), 'en')
  assertEquals(c.calls.length + c2.calls.length, 0)
})

Deno.test('resolveAiLanguage: no body locale → the profile language', async () => {
  assertEquals(await resolveAiLanguage(client({ uiLanguage: 'es' }), 'u1', {}), 'es')
  assertEquals(await resolveAiLanguage(client({ uiLanguage: null }), 'u1', { locale: 'de' }), 'en')
})

Deno.test('resolveAiLanguage: any failure, no client or no user → English', async () => {
  assertEquals(await resolveAiLanguage(client({ error: true }), 'u1', {}), 'en')
  assertEquals(await resolveAiLanguage(client({ throws: true }), 'u1', {}), 'en')
  assertEquals(await resolveAiLanguage(null, 'u1', {}), 'en')
  assertEquals(await resolveAiLanguage(client({ uiLanguage: 'es' }), null, {}), 'en')
})

Deno.test('withOutputLanguage: English is byte-identical, Spanish appends the rule', () => {
  const prompt = 'You write things.\nRules.'
  assertEquals(withOutputLanguage(prompt, 'en'), prompt)
  const es = withOutputLanguage(prompt, 'es')
  assert(es.startsWith(prompt))
  assertStringIncludes(es, SPANISH_OUTPUT_INSTRUCTION)
  assertStringIncludes(es, 'Spanish')
  assertStringIncludes(es, 'JSON keys')
})

Deno.test('per-request language: English outside a request, set inside one, isolated', async () => {
  assertEquals(currentAiLanguage(), 'en')
  setCurrentAiLanguage('es') // no-op outside a context
  assertEquals(currentAiLanguage(), 'en')
  const a = { lang: 'en' as const as 'en' | 'es' }
  const b = { lang: 'en' as const as 'en' | 'es' }
  const [ra, rb] = await Promise.all([
    runWithAiLanguage(a, async () => {
      setCurrentAiLanguage('es')
      await new Promise((r) => setTimeout(r, 5))
      return [currentAiLanguage(), inCurrentLanguage('P')]
    }),
    runWithAiLanguage(b, async () => {
      await new Promise((r) => setTimeout(r, 1))
      return [currentAiLanguage(), inCurrentLanguage('P')]
    }),
  ])
  assertEquals(ra[0], 'es')
  assertStringIncludes(ra[1], SPANISH_OUTPUT_INSTRUCTION)
  assertEquals(rb, ['en', 'P'])
  assertEquals(a.lang, 'es')
})

Deno.test('pick and spanishMonthYear', () => {
  assertEquals(pick('en', 'a', 'b'), 'a')
  assertEquals(pick('es', 'a', 'b'), 'b')
  assertEquals(spanishMonthYear(new Date('2027-01-15T00:00:00Z')), 'enero de 2027')
})
