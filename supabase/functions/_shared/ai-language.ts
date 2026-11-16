/**
 * The language Hockia AI answers a member in (Stage 3, 2026-11-16).
 *
 * Source, in order:
 *   1. the request body field `locale` ('en' | 'es') the client sends with
 *      every Hockia AI call;
 *   2. the caller's profiles.ui_language (read in its own query that falls
 *      back to English, see member-language.ts);
 *   3. English.
 *
 * English prompts stay byte-identical: `withOutputLanguage(system, 'en')`
 * returns the prompt unchanged. Spanish appends one explicit instruction
 * (client/src/locales/glossary.md: neutral Latin American Spanish, Argentine
 * hockey words, no second-person verb forms, no generic masculine). JSON
 * keys, enum tokens, proper nouns and data values stay as they are.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { readMemberLanguage, type LanguageClient, type MemberLanguage } from './member-language.ts'

export type { MemberLanguage } from './member-language.ts'

/** The request body field the client sends: { locale: 'en' | 'es' }. */
export const LOCALE_FIELD = 'locale'

/** A body `locale` value as a language, or null when absent/unknown. */
export function bodyLocale(body: unknown): MemberLanguage | null {
  if (!body || typeof body !== 'object') return null
  const v = (body as Record<string, unknown>)[LOCALE_FIELD]
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (s === 'es' || s.startsWith('es-')) return 'es'
  if (s === 'en' || s.startsWith('en-')) return 'en'
  return null
}

/**
 * The language to answer in: body `locale` > profiles.ui_language > English.
 * Never throws (readMemberLanguage already falls back to English).
 */
export async function resolveAiLanguage(
  supabase: LanguageClient | null | undefined,
  userId: string | null | undefined,
  body: unknown,
): Promise<MemberLanguage> {
  const fromBody = bodyLocale(body)
  if (fromBody) return fromBody
  if (!supabase || !userId) return 'en'
  try {
    return await readMemberLanguage(supabase, userId)
  } catch {
    return 'en'
  }
}

/** The Spanish output rule appended to every Hockia AI system prompt. */
export const SPANISH_OUTPUT_INSTRUCTION = [
  'OUTPUT LANGUAGE: write every word the member reads in Spanish (neutral Latin American Spanish, field hockey words as used in Argentina: arquero/a, volante, córner corto, postulación, plantel).',
  '- Avoid second-person verb forms (no "vos" or "tú" conjugations, no "usted"): prefer statements and infinitives. The possessive "tu" and the pronoun "te" are fine.',
  '- Never use the generic masculine for people: rephrase around the person or use gender-free words ("deportista", "integrante", "quienes se postularon"); use a doublet ("Jugador/a", "Entrenador/a", "Árbitro/a") only for role names.',
  '- Never promise outcomes ("puede", never "va a").',
  '- Keep names of people, clubs, leagues, countries and cities, and data values exactly as given. Hockia and Hockia AI stay as they are.',
  '- JSON keys, tool fields, enum tokens, ids and routes stay in English exactly as specified; only human-readable text is Spanish.',
].join('\n')

/** The system prompt in the member's language. English is returned unchanged. */
export function withOutputLanguage(system: string, lang: MemberLanguage): string {
  if (lang !== 'es') return system
  return `${system}\n\n${SPANISH_OUTPUT_INSTRUCTION}`
}

/** Pick the English or Spanish version of a fixed string. */
export function pick<T>(lang: MemberLanguage, en: T, es: T): T {
  return lang === 'es' ? es : en
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** "enero de 2027" (UTC month), for Spanish fixed text. */
export function spanishMonthYear(d: Date): string {
  return `${MONTHS_ES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

// ============================================================================
// Per-request language for deep call chains (nl-search → llm-client)
// ============================================================================

/** Mutable per-request holder: the request sets `lang` once it knows it. */
export interface AiLanguageHolder { lang: MemberLanguage }

const languageContext = new AsyncLocalStorage<AiLanguageHolder>()

/** Run `fn` with its own language holder (starts as English). */
export function runWithAiLanguage<T>(holder: AiLanguageHolder, fn: () => T): T {
  return languageContext.run(holder, fn)
}

/** The current request's language; English outside a request context. */
export function currentAiLanguage(): MemberLanguage {
  return languageContext.getStore()?.lang ?? 'en'
}

/** Set the current request's language (no-op outside a request context). */
export function setCurrentAiLanguage(lang: MemberLanguage): void {
  const holder = languageContext.getStore()
  if (holder) holder.lang = lang
}

/** withOutputLanguage with the current request's language. */
export function inCurrentLanguage(system: string): string {
  return withOutputLanguage(system, currentAiLanguage())
}
