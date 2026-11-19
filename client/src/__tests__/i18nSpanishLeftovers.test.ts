import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n'
import { setCountryNamesLanguage } from '@/i18n/countryNames'
import { roleOptionsFor, roleResultMeta } from '@/lib/hockiaAi'
import esHockiaAi from '@/locales/es/hockiaAi.json'
import esCommon from '@/locales/es/common.json'
import esEnums from '@/locales/es/enums.json'

/**
 * Found on staging with a Spanish account (2026-11-17): Hockia AI result
 * cards said "Berlin, Germany", and a prepared prompt appeared in English in
 * the member's own bubble.
 */
afterEach(async () => {
  vi.unstubAllGlobals()
  await setLanguage('en')
  await setCountryNamesLanguage('en')
})

const spanish = async () => {
  const catalogs: Record<string, unknown> = { hockiaAi: esHockiaAi, common: esCommon, enums: esEnums }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const ns = Object.keys(catalogs).find((n) => String(url).includes(`/${n}`))
    return new Response(JSON.stringify(ns ? catalogs[ns] : {}), { status: 200 })
  }))
  await setLanguage('es')
  await setCountryNamesLanguage('es')
}

describe('Hockia AI in Spanish', () => {
  it('shows the country of a result in Spanish and leaves English alone', async () => {
    const role = { league_label: null, location_label: 'Berlin, Germany', benefit_labels: ['Housing'] }
    expect(roleResultMeta(role)).toBe('Berlin, Germany. Housing')
    await spanish()
    expect(roleResultMeta(role)).toBe('Berlin, Alemania. Housing')
    expect(roleResultMeta({ league_label: 'Bundesliga', location_label: 'Berlin, Germany', benefit_labels: [] })).toBe('Bundesliga')
  })

  it('carries each prepared prompt in English for Hockia AI and in the member language for their bubble', async () => {
    const english = roleOptionsFor({ role: 'player', coach_recruits_for_team: false }) ?? []
    for (const o of english) if (o.action.type === 'ask') expect(o.action.shown).toBe(o.action.query)
    await spanish()
    const asks = (roleOptionsFor({ role: 'player', coach_recruits_for_team: false }) ?? []).flatMap((o) => (o.action.type === 'ask' ? [o.action] : []))
    expect(asks.length).toBeGreaterThan(0)
    const englishAsks = english.flatMap((o) => (o.action.type === 'ask' ? [o.action] : []))
    asks.forEach((a, i) => {
      expect(a.query).toBe(englishAsks[i].query)
      expect(a.shown).not.toBe(a.query)
    })
  })
})
