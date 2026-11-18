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
 * hockey words, tú to the member, no generic masculine). JSON
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
  'OUTPUT LANGUAGE: write every word the member reads in Spanish: neutral Latin American Spanish, with field hockey words as used in Argentina.',
  '- Speak to the member in "tú" (puedes, revisa, tienes, te avisamos), the way Instagram or WhatsApp do. Never voseo ("podés", "revisá", "tenés") and never "usted". When the text is addressed to a club as a group and a plural is unavoidable, use "ustedes".',
  '- As Hockia AI, speak in the first person ("Encontré 3 volantes", "No pude completar la búsqueda", "¿Busco fuera de tus postulaciones?"). Never ask with a bare infinitive ("¿Buscar...?") and avoid impersonal stand-ins ("se puede", "es posible + infinitive", "conviene", "hay que") where the English says "you".',
  '- Terms (use exactly these): field hockey = hockey sobre césped; outdoor = césped; opportunity, role or opening = oportunidad; apply = postularse; application = postulación; applicant = postulante; shortlist = preselección; signing = incorporación; trial = prueba; reference = referencia; friends or connections = conexiones (never "amistad" or "amigos"); career history = trayectoria; highlights = highlights, video de highlights; claim a club = registrar un club (never "reclamar"); goalkeeper = arquero/a; defender = defensor/a; midfielder = volante; forward = delantero/a; coach = entrenador/a (coaches as an audience = cuerpos técnicos); umpire = árbitro/a; penalty corner = córner corto; squad = plantel; Women\'s / Men\'s team = Damas / Caballeros; paid = pago/paga; flights / car / bonuses = pasajes / auto / premios; strong fit / possible fit = encaje alto / encaje posible; email = email (not "correo"); here = acá.',
  '- Always open questions and exclamations with "¿" and "¡". Sentence case. No em dash and no middle dot ("·") as separators.',
  '- Dates as day and month in words: "2 de octubre", "14 de noviembre"; month and year as "enero de 2027". Never "2 oct" or "10/2" inside a sentence.',
  '- Never use the generic masculine for people: rephrase around the person or use gender-free words ("deportista", "integrante", "quienes se postularon"); use a doublet ("Jugador/a", "Entrenador/a", "Árbitro/a") only for role names. Never invent forms such as "persona jugadora". When the member writes about themself in the first person, use wording without gender ("juego de volante", "juego en la defensa") instead of a doublet.',
  '- Never promise outcomes ("puede", never "va a") and never make a claim stronger or softer than the facts.',
  '- Keep names of people, clubs, leagues, countries and cities, and numbers exactly as given. When a fact arrives in English (a position, team category, package item, duration), write it in Spanish with the terms above in the text the member reads; a field or filter the prompt says to keep as given stays as given. Hockia and Hockia AI stay as they are.',
  '- JSON keys, tool fields, enum tokens, ids and routes stay in English exactly as specified; only human-readable text is Spanish.',
  '- Example of the expected tone: "Encontré 4 volantes en Rosario con video de highlights. ¿Quieres que te muestre primero a quienes juegan en Damas?"',
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
