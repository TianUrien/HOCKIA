import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The attribution state machine — the rules that decide what a member's
 * first touch IS. Each case is one of the failure modes the 2026-08-28 audit
 * found in production, or one of the founder's approved decisions (D2/D3).
 */
const m = vi.hoisted(() => ({ native: false, platform: 'web', session: 's1', consent: 'accepted', rpc: vi.fn(() => Promise.resolve({ error: null })) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native, getPlatform: () => m.platform } }))
vi.mock('@/lib/cookieConsent', () => ({ getConsentStatus: () => m.consent }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: m.rpc } }))
vi.mock('@/lib/analyticsIdentity', async (orig) => {
  const actual = await orig<typeof import('@/lib/analyticsIdentity')>()
  return { ...actual, getSessionId: () => m.session, getAnonymousId: () => 'anon-1', getDeviceContext: () => ({ device: 'Desktop', browser: 'Chrome' }) }
})

import {
  applyTouch, buildSignupPayload, getLastNonDirect, getSessionSource, recordEntryTouch,
  submitSignupAttribution, getAttributionState, __resetAttributionForTests, type AttributionState, type Touch,
  UPGRADE_WINDOW_DAYS, LOOKBACK_DAYS,
} from '@/lib/attribution'

const touch = (over: Partial<Touch>): Touch => ({
  source: 'direct', group: 'direct', medium: null, campaign: null, content: null, term: null,
  referrer: null, referring_domain: null, landing_page: '/', deep_link: null, link_id: null,
  platform: 'web', session_id: 's1', captured_at: '2026-08-01T10:00:00Z', method: 'none',
  raw: { utm: null, referrer: null }, ...over,
})
const fresh = (): AttributionState => ({ v: 2, touches: [], first: null, first_upgraded: false })
const daysAfter = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString()

function setLocation(path: string, search = '', referrer = '') {
  window.history.replaceState({}, '', path + search)
  Object.defineProperty(document, 'referrer', { value: referrer, configurable: true })
}

describe('first touch', () => {
  it('a signal-bearing first touch is immutable — a later Google visit cannot replace Instagram', () => {
    const s = applyTouch(fresh(), touch({ source: 'instagram', group: 'social', method: 'utm' }))
    applyTouch(s, touch({ source: 'google_organic', group: 'search', method: 'referrer', session_id: 's2', captured_at: daysAfter('2026-08-01T10:00:00Z', 3) }))
    expect(s.first?.source).toBe('instagram')
    expect(s.first_upgraded).toBe(false)
  })

  it('D2: a "direct" first touch is upgraded ONCE by the first signal inside the window', () => {
    const s = applyTouch(fresh(), touch({ source: 'direct' }))
    applyTouch(s, touch({ source: 'instagram', group: 'social', method: 'utm', session_id: 's2', captured_at: daysAfter('2026-08-01T10:00:00Z', 10) }))
    expect(s.first?.source).toBe('instagram')
    expect(s.first_upgraded).toBe(true)
    // …and only once: a third signal does not move it again
    applyTouch(s, touch({ source: 'linkedin', group: 'social', method: 'utm', session_id: 's3', captured_at: daysAfter('2026-08-01T10:00:00Z', 12) }))
    expect(s.first?.source).toBe('instagram')
  })

  it('D2: after the upgrade window a "direct" first touch stays direct', () => {
    const s = applyTouch(fresh(), touch({ source: 'direct' }))
    applyTouch(s, touch({ source: 'instagram', group: 'social', method: 'utm', session_id: 's2', captured_at: daysAfter('2026-08-01T10:00:00Z', UPGRADE_WINDOW_DAYS + 1) }))
    expect(s.first?.source).toBe('direct')
    expect(s.first_upgraded).toBe(false)
  })

  it('a home-screen app open never rewrites an Instagram first touch (session ≠ acquisition)', () => {
    const s = applyTouch(fresh(), touch({ source: 'instagram', group: 'social', method: 'utm' }))
    m.session = 's9'
    applyTouch(s, touch({ source: 'direct_app', platform: 'ios', session_id: 's9', captured_at: daysAfter('2026-08-01T10:00:00Z', 40) }))
    expect(s.first?.source).toBe('instagram')
    expect(getSessionSource(s)).toBe('direct_app')
    m.session = 's1'
  })
})

describe('last non-direct (D3)', () => {
  it('returns the newest signal within the lookback and ignores direct visits after it', () => {
    const s = applyTouch(fresh(), touch({ source: 'instagram', group: 'social', method: 'utm' }))
    applyTouch(s, touch({ source: 'google_organic', group: 'search', method: 'referrer', session_id: 's2', captured_at: daysAfter('2026-08-01T10:00:00Z', 5) }))
    applyTouch(s, touch({ source: 'direct', session_id: 's3', captured_at: daysAfter('2026-08-01T10:00:00Z', 20) }))
    expect(getLastNonDirect(s, daysAfter('2026-08-01T10:00:00Z', 21))?.source).toBe('google_organic')
  })

  it('expires beyond the lookback window', () => {
    const s = applyTouch(fresh(), touch({ source: 'instagram', group: 'social', method: 'utm' }))
    expect(getLastNonDirect(s, daysAfter('2026-08-01T10:00:00Z', LOOKBACK_DAYS + 1))).toBeNull()
  })
})

describe('recordEntryTouch (browser integration)', () => {
  beforeEach(() => {
    __resetAttributionForTests()
    localStorage.clear(); sessionStorage.clear()
    m.native = false; m.platform = 'web'; m.session = 's1'; m.rpc.mockClear()
  })

  it('the audit bug: an OAuth return from accounts.google.com is DISCARDED, not recorded', () => {
    setLocation('/', '', '')
    recordEntryTouch()
    m.session = 's2'
    setLocation('/auth/callback', '', 'https://accounts.google.com/o/oauth2/auth')
    const s = recordEntryTouch()!
    expect(s.first?.source).toBe('direct')
    expect(s.touches.some((t) => t.referring_domain === 'accounts.google.com')).toBe(false)
  })

  it('an email-client bounce onto /auth/callback is never a source (Gmail → www.google.com)', () => {
    setLocation('/auth/callback', '', 'https://www.google.com/')
    const s = recordEntryTouch()!
    expect(s.first?.source).toBe('direct')
    expect(s.touches.some((t) => t.referring_domain)).toBe(false)
    // sticky for the life of the document: the next in-app page must not
    // pick the same referrer up either
    setLocation('/complete-profile', '', 'https://www.google.com/')
    const s2 = recordEntryTouch()!
    expect(s2.first?.source).toBe('direct')
    expect(s2.touches.some((t) => t.referring_domain)).toBe(false)
  })

  it('a short-link resolver page (/l/<code>) is a pass-through, never a touch', () => {
    setLocation('/l/ig', '', 'https://l.instagram.com/')
    const s = recordEntryTouch()!
    expect(s.touches).toHaveLength(0)
    expect(s.first).toBeNull()
    // …the redirect it performs IS the touch, with the referrer still intact
    setLocation('/', '?utm_source=instagram&utm_medium=social&utm_campaign=bio&hk_link=ig', 'https://l.instagram.com/')
    const after = recordEntryTouch()!
    expect(after.first?.source).toBe('instagram')
    expect(after.first?.link_id).toBe('ig')
    expect(after.first?.referring_domain).toBe('l.instagram.com')
  })

  it('captures utm + referrer on a tagged landing and keeps raw values', () => {
    setLocation('/opportunities', '?utm_source=ig&utm_medium=social&utm_campaign=bio&hk_link=abc12', 'https://l.instagram.com/')
    const s = recordEntryTouch()!
    expect(s.first?.source).toBe('instagram')
    expect(s.first?.campaign).toBe('bio')
    expect(s.first?.link_id).toBe('abc12')
    expect(s.first?.referring_domain).toBe('l.instagram.com')
    expect(s.first?.raw.utm).toEqual({ source: 'ig', medium: 'social', campaign: 'bio' })
    expect(s.first?.raw.referrer).toBe('https://l.instagram.com/')
  })

  it('inside the native shell a plain open is direct_app, distinct from web direct', () => {
    m.native = true; m.platform = 'ios'
    setLocation('/', '', '')
    const s = recordEntryTouch()!
    expect(s.first?.source).toBe('direct_app')
    expect(s.first?.platform).toBe('ios')
  })

  it('migrates a legacy system-2 first touch, dropping auth-provider garbage from system 1', () => {
    localStorage.setItem('hockia_first_touch', JSON.stringify({ first_referrer: 'https://www.google.com/', first_source: 'google', utm: null, landing_path: '/', first_seen_at: '2026-07-01T00:00:00Z' }))
    localStorage.setItem('hockia-acq', JSON.stringify({ source: 'accounts.google.com', referrer: 'accounts.google.com', landing_path: '/auth/callback', captured_at: '2026-07-01T00:01:00Z' }))
    setLocation('/', '', '')
    const s = recordEntryTouch()!
    expect(s.first?.source).toBe('google_organic')
    expect(s.first?.method).toBe('migrated')
    expect(s.touches.some((t) => t.source.includes('accounts'))).toBe(false)
  })

  it('persists per-tab before consent and durably after (same rule as the visitor id)', () => {
    m.consent = 'pending'
    setLocation('/', '?utm_source=linkedin', 'https://www.linkedin.com/')
    recordEntryTouch()
    expect(sessionStorage.getItem('hockia_attr_v2')).not.toBeNull()
    expect(localStorage.getItem('hockia_attr_v2')).toBeNull()
    m.consent = 'accepted'
    expect(getAttributionState()?.first?.source).toBe('linkedin') // promoted on read
    expect(localStorage.getItem('hockia_attr_v2')).not.toBeNull()
  })
})

describe('signup payload + submit', () => {
  beforeEach(() => { __resetAttributionForTests(); localStorage.clear(); sessionStorage.clear(); m.rpc.mockClear(); m.consent = 'accepted' })

  it('carries first touch, last non-direct, session source, platform and raw values', () => {
    setLocation('/', '?utm_source=ig&utm_medium=social', 'https://l.instagram.com/')
    recordEntryTouch()
    const p = buildSignupPayload(getAttributionState()!) as Record<string, unknown>
    const ft = p.first_touch as Record<string, unknown>
    expect(ft.utm_source).toBe('ig')
    expect(ft.referring_domain).toBe('l.instagram.com')
    expect(ft.client_source).toBe('instagram')
    expect(p.platform).toBe('web')
    expect(p.anonymous_id).toBe('anon-1')
    expect(p.session_source).toBe('instagram')
  })

  it('submits once per ACCOUNT — a second person on the same browser still gets a row', async () => {
    setLocation('/', '', '')
    recordEntryTouch()
    submitSignupAttribution('user-a'); submitSignupAttribution('user-a')
    await new Promise((r) => setTimeout(r, 0))
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect((m.rpc.mock.calls[0] as unknown as unknown[])[0]).toBe('record_signup_attribution')
    submitSignupAttribution('user-a')
    expect(m.rpc).toHaveBeenCalledTimes(1)
    // the audit bug (2026-08-28): the flag was per browser, so user-b got nothing
    submitSignupAttribution('user-b')
    await new Promise((r) => setTimeout(r, 0))
    expect(m.rpc).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('hockia_attr_submitted')).toBe('user-b')
  })

  it('without a user id (legacy callers) it stays once-per-browser', async () => {
    setLocation('/', '', '')
    recordEntryTouch()
    submitSignupAttribution()
    await new Promise((r) => setTimeout(r, 0))
    submitSignupAttribution()
    expect(m.rpc).toHaveBeenCalledTimes(1)
  })
})
