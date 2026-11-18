/**
 * Member email polish (2026-11-18 audit of every member email in both languages).
 *
 * Pinned here:
 *   1. Text templates never print a label with nothing after it.
 *   2. A member without a first name gets a greeting that reads naturally.
 *   3. Vacancy emails: the country in Spanish for Spanish readers, a summary
 *      cut at a word, and the per-recipient greeting.
 *   4. No middle-dot or bullet separators in the copy of member emails and push.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { interpolateText, namelessGreeting } from './email-renderer.ts'
import { personaliseGreeting, vacancyLocation, vacancySummary } from './vacancy-email.ts'
import { offerDateLabel } from './offer-email.ts'

Deno.test('text templates: a label with an empty value is dropped, the rest is kept', () => {
  const template = 'POSTULANTE:\n{{name}}\nPosición: {{position}}\nUbicación: {{location}}\nMensaje: "{{note}}"\n\n\n\nVer: {{url}}'
  assertEquals(
    interpolateText(template, { name: 'Ana', position: '', location: 'Rosario', note: '', url: 'https://h.test' }),
    'POSTULANTE:\nAna\nUbicación: Rosario\n\nVer: https://h.test',
  )
  // Nothing empty: unchanged apart from the variables.
  assertEquals(interpolateText('Location: {{location}}', { location: 'Rosario' }), 'Location: Rosario')
  // A heading line without variables is never dropped.
  assertEquals(interpolateText('APPLICANT:\n{{name}}', { name: '' }), 'APPLICANT:')
  // A sentence that merely contains an empty variable stays.
  assertEquals(interpolateText('Hola {{name}}, tienes novedades.', { name: '' }), 'Hola , tienes novedades.')
})

Deno.test('greeting without a first name', () => {
  assertEquals(namelessGreeting('Hola, {{first_name}}:'), 'Hola:')
  assertEquals(namelessGreeting('Hola, {{first_name}}. Tienes mensajes sin leer en Hockia.'), 'Hola. Tienes mensajes sin leer en Hockia.')
  assertEquals(namelessGreeting('Hi {{first_name}},'), 'Hi there,')
  assertEquals(namelessGreeting('Hi {{first_name}}, you have unread messages on Hockia.'), 'Hi there, you have unread messages on Hockia.')
})

Deno.test('vacancy email: location, summary and per-recipient greeting', () => {
  const v = { location_city: 'Amsterdam', location_country: 'Netherlands' }
  assertEquals(vacancyLocation(v), 'Amsterdam, Netherlands')
  assertEquals(vacancyLocation(v, 'es'), 'Amsterdam, Países Bajos')
  assertEquals(vacancyLocation({ location_city: '', location_country: 'Germany' }, 'es'), 'Alemania')
  assertEquals(vacancyLocation({ location_city: 'Rosario', location_country: '' }, 'es'), 'Rosario')
  assertEquals(vacancyLocation({ location_city: '', location_country: '' }), '')

  assertEquals(vacancySummary('Short text.'), 'Short text.')
  assertEquals(vacancySummary(null), '')
  const long = 'word '.repeat(80).trim()
  const cut = vacancySummary(long)
  assert(cut.length <= 201 && cut.endsWith('word…'), cut)

  const S = '__S__'
  assertEquals(personaliseGreeting(`Hola, ${S}. Hay novedades.`, S, 'Ana'), 'Hola, Ana. Hay novedades.')
  assertEquals(personaliseGreeting(`Hola, ${S}. Hay novedades.`, S, ''), 'Hola. Hay novedades.')
  assertEquals(personaliseGreeting(`Hola, ${S}:`, S, ' '), 'Hola:')
  assertEquals(personaliseGreeting(`Hi ${S}, a new opportunity`, S, ''), 'Hi there, a new opportunity')
  assertEquals(personaliseGreeting(`Hi ${S}, a new opportunity`, S, 'Ben'), 'Hi Ben, a new opportunity')
})

Deno.test('offer email: the last day to answer, in the member language', () => {
  assertEquals(offerDateLabel('2026-11-25', 'es'), '25 de noviembre')
  assertEquals(offerDateLabel('2026-11-25', 'en'), '25 November')
  assertEquals(offerDateLabel('2026-12-01T00:00:00+00:00', 'es'), '1 de diciembre')
  assertEquals(offerDateLabel(null, 'es'), null)
  assertEquals(offerDateLabel('not a date', 'en'), null)
})

Deno.test('member emails and push: no middle-dot or bullet separators in copy', async () => {
  const here = new URL('.', import.meta.url)
  const files = [
    'application-email.ts', 'vacancy-email.ts', 'friend-request-email.ts', 'message-digest-email.ts',
    'reference-request-email.ts', 'reference-response-email.ts', 'reference-reminder-email.ts',
    'profile-views-email.ts', 'club-reminder-email.ts', 'club-reminders.ts', 'opportunity-suggestions.ts',
    'age-gate-email-es.ts', 'email-renderer.ts', 'offer-email.ts',
    '../notify-application-status/index.ts', '../notify-application-digest/index.ts',
    '../notify-application-expiry/index.ts', '../notify-opportunity-renewal/index.ts',
    '../notify-age-gate/index.ts', '../notify-vacancy/index.ts', '../notify-application/index.ts',
    '../notify-onboarding-reminder/index.ts', '../notify-profile-views/index.ts',
    '../notify-message-digest/index.ts', '../send-push/push-payload.ts',
  ]
  const offenders: string[] = []
  for (const f of files) {
    const source = await Deno.readTextFile(new URL(f, here))
    source.split('\n').forEach((line, i) => {
      const code = line.trim()
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
      const withoutTrailingComment = line.replace(/\s\/\/ .*$/, '')
      if (/ [·•] |&middot;|&bull;|\\u2022|\\u00b7/i.test(withoutTrailingComment)) offenders.push(`${f}:${i + 1}`)
    })
  }
  assertEquals(offenders, [])
})
