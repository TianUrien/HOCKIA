import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  platform: 'android',
  getReferrer: vi.fn(),
  consent: 'accepted',
  session: 's1',
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => m.platform !== 'web', getPlatform: () => m.platform },
  registerPlugin: () => ({ getReferrer: m.getReferrer }),
}))
vi.mock('@/lib/cookieConsent', () => ({ getConsentStatus: () => m.consent }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/analyticsIdentity', async (orig) => {
  const actual = await orig<typeof import('@/lib/analyticsIdentity')>()
  return { ...actual, getSessionId: () => m.session, getAnonymousId: () => 'anon-1', getDeviceContext: () => ({ device: 'Mobile', browser: 'Chrome' }) }
})

import { captureInstallReferrer, hasCampaign, INSTALL_REFERRER_KEY } from '@/lib/installReferrer'
import { getAttributionState, recordEntryTouch, buildSignupPayload, __resetAttributionForTests } from '@/lib/attribution'

describe('hasCampaign', () => {
  it('recognises Play\'s organic markers as "no campaign"', () => {
    expect(hasCampaign('utm_source=google-play&utm_medium=organic')).toBe(false)
    expect(hasCampaign('utm_source=(not set)&utm_medium=(not set)')).toBe(false)
    expect(hasCampaign('')).toBe(false)
    expect(hasCampaign('utm_source=instagram&utm_medium=social&hk_link=ig-app')).toBe(true)
  })
})

describe('captureInstallReferrer', () => {
  beforeEach(() => {
    __resetAttributionForTests()
    localStorage.clear(); sessionStorage.clear()
    m.platform = 'android'; m.getReferrer.mockReset()
    window.history.replaceState({}, '', '/')
  })

  it('a tagged Play install upgrades the launch\'s direct_app first touch and is reported as install_referrer', async () => {
    recordEntryTouch() // the app opened: direct_app, no signal
    expect(getAttributionState()?.first?.source).toBe('direct_app')
    m.getReferrer.mockResolvedValue({ available: true, referrer: 'utm_source=instagram&utm_medium=social&utm_campaign=bio_app&hk_link=ig-app' })
    await captureInstallReferrer()
    const s = getAttributionState()!
    expect(s.first?.source).toBe('instagram')
    expect(s.first?.campaign).toBe('bio_app')
    expect(s.first?.link_id).toBe('ig-app')
    expect(s.first?.method).toBe('install_referrer')
    expect(s.first?.platform).toBe('android')
    expect(buildSignupPayload(s).attribution_method).toBe('install_referrer')
    expect(localStorage.getItem(INSTALL_REFERRER_KEY)).not.toBeNull()
  })

  it('an organic Play install is recorded as google_play (store), distinct from unknown', async () => {
    m.getReferrer.mockResolvedValue({ available: true, referrer: 'utm_source=google-play&utm_medium=organic' })
    await captureInstallReferrer()
    expect(getAttributionState()?.first?.source).toBe('google_play')
    expect(getAttributionState()?.first?.group).toBe('store')
  })

  it('runs once per install', async () => {
    m.getReferrer.mockResolvedValue({ available: true, referrer: 'utm_source=instagram' })
    await captureInstallReferrer()
    await captureInstallReferrer()
    expect(m.getReferrer).toHaveBeenCalledTimes(1)
  })

  it('asks again next launch when Play could not answer, and never throws', async () => {
    m.getReferrer.mockResolvedValue({ available: false, reason: 'response_2' })
    await captureInstallReferrer()
    expect(localStorage.getItem(INSTALL_REFERRER_KEY)).toBeNull()
    m.getReferrer.mockRejectedValue(new Error('bridge down'))
    await expect(captureInstallReferrer()).resolves.toBeNull()
  })

  it('does nothing on iOS or the web', async () => {
    m.platform = 'ios'
    await captureInstallReferrer()
    m.platform = 'web'
    await captureInstallReferrer()
    expect(m.getReferrer).not.toHaveBeenCalled()
  })
})
