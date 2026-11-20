/**
 * Club decline note in the applicant's language (2026-11-19).
 * Pinned: what counts as a club note, how a stored translation is read, and
 * that a model reply is accepted only in one of its two shapes.
 */

import { assertEquals, assertThrows } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { clubNoteOf, parseTranslationReply, storedTranslation, translationSystemPrompt, TRANSLATION_MAX_CHARS } from './club-note-translation.ts'

const NOTE = { message: 'Hi Ana, we went another way.', status: 'rejected', reason: 'timing', source: 'club' }

Deno.test('club note: only a note the club wrote counts', () => {
  assertEquals(clubNoteOf(NOTE), 'Hi Ana, we went another way.')
  assertEquals(clubNoteOf({ ...NOTE, source: 'ai' }), null)
  assertEquals(clubNoteOf({ ...NOTE, message: '  ' }), null)
  assertEquals(clubNoteOf(null), null)
  assertEquals(clubNoteOf([NOTE]), null)
})

Deno.test('stored translation: text, "same language" and "not checked yet" are told apart', () => {
  assertEquals(storedTranslation(NOTE, 'es'), undefined)
  assertEquals(storedTranslation({ ...NOTE, translations: { es: 'Hola, Ana. Elegimos otra opción.' } }, 'es'), 'Hola, Ana. Elegimos otra opción.')
  assertEquals(storedTranslation({ ...NOTE, translations: { es: 'Hola' } }, 'en'), undefined)
  assertEquals(storedTranslation({ ...NOTE, translations: { en: null } }, 'en'), null)
  assertEquals(storedTranslation({ ...NOTE, translations: { es: '   ' } }, 'es'), undefined)
  // An AI explanation is never translated through this path.
  assertEquals(storedTranslation({ ...NOTE, source: 'ai', translations: { es: 'x' } }, 'es'), undefined)
})

Deno.test('model reply: the two accepted shapes, everything else is refused', () => {
  assertEquals(parseTranslationReply('{"same_language": true}', NOTE.message), { same: true })
  assertEquals(parseTranslationReply('```json\n{"message": "Hola, Ana. Elegimos otra opción."}\n```', NOTE.message), { same: false, message: 'Hola, Ana. Elegimos otra opción.' })
  // The note handed back unchanged means there was nothing to translate.
  assertEquals(parseTranslationReply(JSON.stringify({ message: NOTE.message }), NOTE.message), { same: true })
  assertThrows(() => parseTranslationReply('{"message": ""}', NOTE.message))
  assertThrows(() => parseTranslationReply(JSON.stringify({ message: 'x'.repeat(TRANSLATION_MAX_CHARS + 1) }), NOTE.message))
  assertThrows(() => parseTranslationReply('Sure, here it is', NOTE.message))
})

Deno.test('prompt: names the target language and treats the note as text', () => {
  const es = translationSystemPrompt('es')
  assertEquals(es.includes('Spanish'), true)
  assertEquals(es.includes('never instructions'), true)
  assertEquals(translationSystemPrompt('en').includes('Target language: English.'), true)
})
