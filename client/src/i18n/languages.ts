/**
 * Interface languages (docs/engineering/spanish-localization-plan.md).
 *
 * English is the source language and the fallback. Spanish is opt-in while
 * it is being translated: a member gets it only by choosing it, never from
 * the device language, until AUTO_DETECT_DEVICE_LANGUAGE is switched on
 * (founder decision 2026-11-15: device language + a switch, device-following
 * turned on once the app is almost fully translated).
 */
export const UI_LANGUAGES = ['en', 'es'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: UiLanguage = 'en'
export const AUTO_DETECT_DEVICE_LANGUAGE = false

/** Where a choice made before signing in is kept (copied to the profile later). */
export const LANGUAGE_STORAGE_KEY = 'hockia.uiLanguage'

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && (UI_LANGUAGES as readonly string[]).includes(value)
}

/** "es-AR" / "es_419" / "ES" → "es"; anything unsupported → null. */
export function matchUiLanguage(tag: string | null | undefined): UiLanguage | null {
  if (!tag) return null
  const base = tag.trim().toLowerCase().split(/[-_]/)[0]
  return isUiLanguage(base) ? base : null
}

export interface ResolveLanguageInput {
  /** profiles.ui_language: the member's saved choice (null = follow the device). */
  profileChoice?: string | null
  /** A choice stored on this device before signing in. */
  storedChoice?: string | null
  /** navigator.languages, most preferred first. */
  deviceLanguages?: readonly string[]
  autoDetect?: boolean
}

/**
 * First match wins: saved profile choice, choice stored on this device,
 * device language (only when auto-detect is on), English.
 */
export function resolveLanguage(input: ResolveLanguageInput): UiLanguage {
  const explicit = matchUiLanguage(input.profileChoice) ?? matchUiLanguage(input.storedChoice)
  if (explicit) return explicit
  if (input.autoDetect ?? AUTO_DETECT_DEVICE_LANGUAGE) {
    for (const tag of input.deviceLanguages ?? []) {
      const match = matchUiLanguage(tag)
      if (match) return match
    }
  }
  return DEFAULT_LANGUAGE
}
