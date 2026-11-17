import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import path from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import i18n, { currentLanguage, setLanguage, t } from '@/i18n'
import { matchUiLanguage, resolveLanguage } from '@/i18n/languages'
import { formatList, formatNumber } from '@/i18n/format'
import { pseudoString } from '@/i18n/pseudo'
import { clockTime, dayFirst } from '@/lib/dayFirst'
import esCommon from '@/locales/es/common.json'
import OfflinePage from '@/pages/OfflinePage'
// @ts-expect-error plain .mjs script, no types
import { checkLocales } from '../../scripts/check-locales.mjs'

/** The suite has no network: serve the Spanish catalog the way the app would fetch it. */
function serveSpanish() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(esCommon), { status: 200 })))
}

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await setLanguage('en')
})

describe('resolveLanguage', () => {
  it('prefers the saved profile choice, then the choice stored on the device', () => {
    expect(resolveLanguage({ profileChoice: 'es', storedChoice: 'en' })).toBe('es')
    expect(resolveLanguage({ profileChoice: null, storedChoice: 'es' })).toBe('es')
  })

  it('follows the device language by default, most preferred first', () => {
    expect(resolveLanguage({ deviceLanguages: ['es-AR', 'en'] })).toBe('es')
    expect(resolveLanguage({ deviceLanguages: ['en-US', 'es-AR'] })).toBe('en')
    expect(resolveLanguage({ deviceLanguages: ['pt-BR', 'es-AR', 'en'] })).toBe('es')
    expect(resolveLanguage({ deviceLanguages: ['de-DE'] })).toBe('en')
  })

  it('lets a saved or stored choice win over the device language', () => {
    expect(resolveLanguage({ profileChoice: 'en', deviceLanguages: ['es-AR'] })).toBe('en')
    expect(resolveLanguage({ storedChoice: 'en', deviceLanguages: ['es-AR'] })).toBe('en')
  })

  it('ignores the device language when auto-detect is off', () => {
    expect(resolveLanguage({ deviceLanguages: ['es-AR', 'en'], autoDetect: false })).toBe('en')
  })

  it('falls back to English for anything it does not support', () => {
    expect(resolveLanguage({ profileChoice: 'fr', storedChoice: 'xx' })).toBe('en')
    expect(matchUiLanguage('es_419')).toBe('es')
    expect(matchUiLanguage('')).toBeNull()
  })
})

describe('language switch', () => {
  it('starts in English', () => {
    expect(currentLanguage()).toBe('en')
    expect(t('offline.title')).toBe('You’re offline')
  })

  it('renders a migrated screen in Spanish after switching', async () => {
    serveSpanish()
    await setLanguage('es')
    render(<MemoryRouter><OfflinePage /></MemoryRouter>)
    expect(screen.getByText('Sin conexión')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('es')
  })

  it('shows English, never the key, when a Spanish string is missing', async () => {
    serveSpanish()
    await setLanguage('es')
    i18n.addResourceBundle('en', 'common', { onlyInEnglish: 'Only in English' }, true, true)
    expect(i18n.t('onlyInEnglish' as never)).toBe('Only in English')
  })

  it('stays in English when the Spanish catalog cannot be loaded', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const fresh = await import('@/i18n')
    await fresh.setLanguage('es')
    expect(fresh.t('offline.title')).toBe('You’re offline')
    await fresh.setLanguage('en')
  })
})

describe('dates and numbers', () => {
  const day = new Date(2026, 9, 3, 10, 4)
  const now = new Date(2026, 10, 16)

  it('keeps the English shapes exactly', () => {
    expect(dayFirst(day, { now })).toBe('3 Oct')
    expect(dayFirst(day, { now, year: 'always' })).toBe('3 Oct 2026')
    expect(clockTime(day)).toBe('10:04 AM')
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatList(['A', 'B', 'C'])).toBe('A, B, and C')
  })

  it('writes them the Spanish way in Spanish', async () => {
    serveSpanish()
    await setLanguage('es')
    expect(dayFirst(day, { now })).toBe('3 oct')
    expect(dayFirst(day, { now, year: 'always' })).toBe('3 oct 2026')
    expect(clockTime(day)).toBe('10:04')
    expect(formatNumber(1234567)).toBe('1.234.567')
    expect(formatList(['A', 'B', 'C'])).toBe('A, B y C')
  })
})

describe('pseudo-locale', () => {
  it('lengthens text and leaves variables and tags alone', () => {
    const out = pseudoString('Hello {{name}}, <b>welcome</b>')
    expect(out).toContain('{{name}}')
    expect(out).toContain('<b>')
    expect(out.startsWith('[')).toBe(true)
    expect(out.length).toBeGreaterThan('Hello {{name}}, <b>welcome</b>'.length)
  })
})

describe('check-locales', () => {
  function locales(en: object, es: object | null) {
    const dir = mkdtempSync(path.join(tmpdir(), 'locales-'))
    mkdirSync(path.join(dir, 'en')); mkdirSync(path.join(dir, 'es'))
    writeFileSync(path.join(dir, 'en', 'x.json'), JSON.stringify(en))
    if (es) writeFileSync(path.join(dir, 'es', 'x.json'), JSON.stringify(es))
    return dir
  }

  it('passes the real catalogs', () => {
    expect(checkLocales(path.resolve(__dirname, '../locales'))).toEqual([])
  })

  it('reports a missing file, key and plural form', () => {
    expect(checkLocales(locales({ a: 'A' }, null))).toEqual(['es/x.json: file is missing'])
    expect(checkLocales(locales({ a: 'A', b: { c: 'C' } }, { a: 'A' }))).toEqual(['es/x.json: missing "b.c"'])
    const plural = checkLocales(locales({ n_one: '{{count}} role', n_other: '{{count}} roles' }, { n_one: '{{count}} búsqueda', n_other: '{{count}} búsquedas' }))
    expect(plural).toEqual(['es/x.json: "n" needs the plural form "_many"'])
  })

  it('reports extra keys, empty values and changed variables', () => {
    expect(checkLocales(locales({ a: 'A' }, { a: 'A', z: 'Z' }))).toEqual(['es/x.json: "z" does not exist in English'])
    expect(checkLocales(locales({ a: 'A' }, { a: ' ' }))).toEqual(['es/x.json: "a" is empty'])
    expect(checkLocales(locales({ a: 'Hi {{name}}' }, { a: 'Hola {{nombre}}' }))[0]).toContain('different variables')
  })

  it('lets a singular form say the number in words, but nowhere else', () => {
    const en = { d_one: 'In the last {{count}} day', d_other: 'In the last {{count}} days' }
    expect(checkLocales(locales(en, { d_one: 'En el último día', d_many: 'En los últimos {{count}} días', d_other: 'En los últimos {{count}} días' }))).toEqual([])
    expect(checkLocales(locales(en, { d_one: 'En el último día', d_many: 'En los últimos días', d_other: 'En los últimos {{count}} días' }))[0]).toContain('different variables')
  })
})
