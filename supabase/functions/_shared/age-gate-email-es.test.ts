import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { ageGateEmailEs, spanishDayMonth, type AgeGateKind } from './age-gate-email-es.ts'

const button = (url: string, label: string) => `<a href="${url}">${label}</a>`
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ENGLISH = /\b(the|your|you|and|with|confirm|birth|profile|welcome|saved|deleted|questions|browse)\b/i

Deno.test('age-gate Spanish: dates as "14 de noviembre"', () => {
  assertEquals(spanishDayMonth(new Date('2026-11-14T12:00:00Z')), '14 de noviembre')
})

Deno.test('age-gate Spanish: every kind is Spanish, greets with or without a name', () => {
  const kinds: AgeGateKind[] = ['goodbye', 'welcome_back', 'dob_request', 'dob_reminder']
  for (const kind of kinds) {
    for (const firstName of ['Ana', '']) {
      const e = ageGateEmailEs({
        kind, firstName, baseUrl: 'https://h.test', waitlistUrl: 'https://h.test/juniors-waitlist?e=x',
        deadline: new Date('2026-11-14T12:00:00Z'), suggestionsHtml: '', suggestionsText: '', button, escapeHtml,
      })
      for (const t of [e.subject, e.text.replace(/https?:\/\/\S+/g, ''), e.inner.replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, '')]) {
        const hit = t.replace(/Hockia Juniors|Hockia|team@inhockia\.com/g, '').match(ENGLISH)
        assert(!hit, `${kind}: leftover English "${hit?.[0]}" in: ${t}`)
      }
      if (kind !== 'welcome_back') assertStringIncludes(e.text, firstName ? 'Hola, Ana:' : 'Hola:')
      if (kind === 'dob_reminder' || kind === 'dob_request') assertStringIncludes(e.text, '14 de noviembre')
    }
  }
})
