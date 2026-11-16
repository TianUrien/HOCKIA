/**
 * Dates, numbers and lists in the interface language.
 *
 * English output is owned by the existing helpers (lib/dayFirst: "3 Oct",
 * "10:04 AM") and must not change. These helpers cover every other language
 * through Intl, so no per-language tables are kept by hand. Plurals belong
 * in the catalogs (`key_one` / `key_other`), not here.
 *
 * Reads the language from the shared i18next instance, so it can be used
 * from plain functions as well as components.
 */
import i18n from 'i18next'
import type { Locale } from 'date-fns'

/** BCP 47 tag for Intl: the interface language, English when unset. */
export function intlLocale(): string {
  return i18n.language || 'en'
}

export function isEnglish(): boolean {
  return intlLocale().startsWith('en')
}

/** "3 oct" / "3 oct 2026": day first, short month, in the interface language. */
export function formatDayMonth(date: Date, withYear: boolean): string {
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
    .format(date)
    .replace(/\./g, '')
}

/** Clock time as the language writes it ("10:04" in Spanish). */
export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), { hour: 'numeric', minute: '2-digit' }).format(date)
}

/** "1.234" in Spanish, "1,234" in English. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(), options).format(value)
}

/** "A, B y C" / "A, B and C". */
export function formatList(items: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  return new Intl.ListFormat(intlLocale(), { style: 'long', type }).format(items)
}

let dateFnsLocale: Locale | undefined

/** Pass as `{ locale }` to date-fns calls that print words (formatDistanceToNow, format with month names). */
export function getDateFnsLocale(): Locale | undefined {
  return isEnglish() ? undefined : dateFnsLocale
}

/** Fetches the date-fns locale for a language (English is built in). */
export async function loadDateFnsLocale(language: string): Promise<void> {
  if (language === 'es' && !dateFnsLocale) dateFnsLocale = (await import('date-fns/locale/es')).es
}
