/**
 * Interface translation set-up (docs/engineering/spanish-localization-plan.md).
 *
 * - English catalogs are imported as JS, so each travels in the chunk of the
 *   screen that uses it and English never waits on a request.
 * - Spanish catalogs are JSON assets fetched on demand (they are not JS and
 *   stay out of the raw-JS bundle gate). A catalog that fails to load leaves
 *   the screen in English.
 * - A key missing in Spanish shows the English string and is reported once.
 *
 * Outside React use `t` from here; inside components use `useTranslation`.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { logger } from '@/lib/logger'
import enCommon from '@/locales/en/common.json'
import { loadDateFnsLocale } from './format'
import { pseudoCatalog, type Catalog } from './pseudo'
import {
  DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, isUiLanguage, resolveLanguage, type UiLanguage,
} from './languages'

/** Namespaces loaded at start-up. Screen namespaces register themselves. */
const ENGLISH: Record<string, Catalog> = { common: enCommon }

/** URL of each Spanish catalog, keyed by namespace. Nothing is fetched until asked for. */
const SPANISH_URLS = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../locales/es/*.json', { query: '?url', import: 'default', eager: true }))
    .map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), url]),
)

const reportedMissing = new Set<string>()
const spanishLoads = new Map<string, Promise<void>>()

void i18n.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: ['en', 'es', 'en-XA'],
  ns: Object.keys(ENGLISH),
  defaultNS: 'common',
  resources: { en: ENGLISH },
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  // 'added': screens re-render when a Spanish catalog arrives after them.
  react: { useSuspense: false, bindI18nStore: 'added' },
  saveMissing: true,
  missingKeyHandler: (languages, namespace, key) => {
    const id = `${namespace}:${key}`
    if (reportedMissing.has(id)) return
    reportedMissing.add(id)
    logger.error(`[i18n] missing key ${id} (${languages.join(',')})`)
  },
})

async function readCatalog(url: string): Promise<Catalog> {
  // Small catalogs are inlined by the bundler as a data: URL; decode those
  // here rather than fetching (the CSP does not allow data: in connect-src).
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    const body = url.slice(comma + 1)
    return JSON.parse(url.slice(0, comma).endsWith(';base64') ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body)) as Catalog
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as Catalog
}

/** Loads one Spanish namespace once. Never rejects: on failure the namespace stays English. */
export function loadSpanishNamespace(namespace: string): Promise<void> {
  const existing = spanishLoads.get(namespace)
  if (existing) return existing
  const url = SPANISH_URLS[namespace]
  if (!url) return Promise.resolve()
  const load = readCatalog(url)
    .then((catalog) => { i18n.addResourceBundle('es', namespace, catalog, true, true) })
    .catch((error: unknown) => {
      spanishLoads.delete(namespace)
      logger.error(`[i18n] could not load es/${namespace}`, error)
    })
  spanishLoads.set(namespace, load)
  return load
}

/**
 * Registers a screen's English namespace (call at module top level, next to
 * the import of its catalog) and starts loading its Spanish one when Spanish
 * is active.
 */
export function registerNamespace(namespace: string, english: Catalog): void {
  // Deep merge: a namespace may arrive in two parts (its start-up core, then the rest).
  i18n.addResourceBundle('en', namespace, english, true, true)
  if (i18n.language === 'es') void loadSpanishNamespace(namespace)
}

export function currentLanguage(): UiLanguage {
  return isUiLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE
}

/** Switches the interface language; resolves when the new catalogs are in. */
export async function setLanguage(language: UiLanguage, options: { remember?: boolean } = {}): Promise<void> {
  if (language === 'es') {
    // Every Spanish catalog, not only those whose screen has loaded: a lazy
    // screen opened later is then Spanish on its first frame.
    await Promise.all([...Object.keys(SPANISH_URLS).map(loadSpanishNamespace), loadDateFnsLocale(language).catch(() => undefined)])
  }
  await i18n.changeLanguage(language)
  if (typeof document !== 'undefined') document.documentElement.lang = language
  if (options.remember) {
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language) } catch (error) { logger.debug('[i18n] could not store the language', error) }
  }
}

function storedChoice(): string | null {
  try { return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) } catch { return null }
}

function resolveNow(profileChoice?: string | null): UiLanguage {
  return resolveLanguage({
    profileChoice,
    storedChoice: typeof window === 'undefined' ? null : storedChoice(),
    deviceLanguages: typeof navigator === 'undefined' ? [] : navigator.languages,
  })
}

/** True when start-up must wait for catalogs before the first frame (anything but English). */
export function startupNeedsCatalogs(): boolean {
  return resolveNow() !== DEFAULT_LANGUAGE
}

/**
 * Picks the language for this session. Call at start-up (no profile yet) and
 * again when the profile loads or changes.
 */
export function applyResolvedLanguage(profileChoice?: string | null): Promise<void> {
  const next = resolveNow(profileChoice)
  return next === currentLanguage() ? Promise.resolve() : setLanguage(next)
}

/** The choice stored on this device, if it is a supported language. */
export function storedLanguage(): UiLanguage | null {
  const value = typeof window === 'undefined' ? null : storedChoice()
  return isUiLanguage(value) ? value : null
}

/** Development only: `window.__hockiaPseudoLocale()` in the console. */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __hockiaPseudoLocale?: () => void }).__hockiaPseudoLocale = () => {
    for (const [namespace, catalog] of Object.entries(i18n.getDataByLanguage('en') ?? {})) {
      i18n.addResourceBundle('en-XA', namespace, pseudoCatalog(catalog as Catalog), true, true)
    }
    void i18n.changeLanguage('en-XA')
  }
}

export const t = i18n.t.bind(i18n)
export default i18n
