import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Consent status is mocked per-test so we can assert durable vs. per-tab storage.
const consent = vi.hoisted(() => ({ status: 'accepted' as 'accepted' | 'declined' | null }))
vi.mock('@/lib/cookieConsent', () => ({
  getConsentStatus: () => consent.status,
}))

import {
  getAnonymousId,
  getSessionId,
  classifySource,
  getDeviceContext,
  captureFirstTouch,
  getFirstTouch,
  analyticsContext,
} from '@/lib/analyticsIdentity'

function setUA(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

beforeEach(() => {
  consent.status = 'accepted'
  localStorage.clear()
  sessionStorage.clear()
  vi.useRealTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('analyticsIdentity — visitor id', () => {
  it('is stable and durable in localStorage once consent is accepted', () => {
    const a = getAnonymousId()
    const b = getAnonymousId()
    expect(a).toBe(b)
    expect(localStorage.getItem('hockia_anon_id')).toBe(a)
  })

  it('falls back to sessionStorage (no cross-session cookie) before consent', () => {
    consent.status = null
    const a = getAnonymousId()
    expect(sessionStorage.getItem('hockia_anon_id')).toBe(a)
    expect(localStorage.getItem('hockia_anon_id')).toBeNull()
  })

  // Caught by live verification: without this migration the id stays in
  // sessionStorage forever, so every return visit looks brand new and the
  // unique-vs-returning split is meaningless.
  it('MIGRATES the pre-consent id to durable storage once consent is granted', () => {
    consent.status = null
    const before = getAnonymousId()
    expect(localStorage.getItem('hockia_anon_id')).toBeNull()

    consent.status = 'accepted'
    const after = getAnonymousId()

    expect(after).toBe(before) // same visitor, not a new identity
    expect(localStorage.getItem('hockia_anon_id')).toBe(before)
  })
})

describe('analyticsIdentity — sessionization', () => {
  it('keeps the same session id within the 30-minute window', () => {
    const a = getSessionId()
    const b = getSessionId()
    expect(a).toBe(b)
  })

  it('rotates the session id after 30 minutes of inactivity', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
    const first = getSessionId()
    vi.setSystemTime(new Date(2026, 0, 1, 12, 31, 0)) // +31 min
    const second = getSessionId()
    expect(second).not.toBe(first)
  })

  it('mirrors to the legacy session key the old tracker reads', () => {
    const id = getSessionId()
    expect(sessionStorage.getItem('hockia_engagement_session_id')).toBe(id)
  })
})

describe('analyticsIdentity — source classification', () => {
  it('classifies UTM source over referrer', () => {
    expect(classifySource('https://l.instagram.com/', 'google_ads')).toBe('google')
    expect(classifySource(null, 'linkedin')).toBe('linkedin')
  })
  it('classifies referrer hostnames', () => {
    expect(classifySource('https://www.google.com/search', null)).toBe('google')
    expect(classifySource('https://www.linkedin.com/feed', null)).toBe('linkedin')
    expect(classifySource('https://l.facebook.com/', null)).toBe('meta')
    expect(classifySource('https://t.co/abc', null)).toBe('twitter')
  })
  it('treats empty referrer as direct and unknown host as referral', () => {
    expect(classifySource('', null)).toBe('direct')
    expect(classifySource(null, null)).toBe('direct')
    expect(classifySource('https://some-blog.example/post', null)).toBe('referral')
  })
})

describe('analyticsIdentity — device parsing', () => {
  it('detects mobile / tablet / desktop', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Mobile Safari')
    expect(getDeviceContext().device).toBe('mobile')
    setUA('Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit Safari')
    expect(getDeviceContext().device).toBe('tablet')
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari')
    const d = getDeviceContext()
    expect(d.device).toBe('desktop')
    expect(d.browser).toBe('chrome')
  })
})

describe('analyticsIdentity — first touch', () => {
  it('captures referrer/utm/path once and is idempotent', () => {
    Object.defineProperty(window.document, 'referrer', {
      value: 'https://www.linkedin.com/feed',
      configurable: true,
    })
    window.history.replaceState({}, '', '/?utm_source=linkedin&utm_campaign=launch')

    const ft = captureFirstTouch()
    expect(ft.first_source).toBe('linkedin')
    expect(ft.utm).toEqual({ source: 'linkedin', campaign: 'launch' })
    expect(ft.landing_path).toBe('/')
    expect(ft.anonymous_id).toBeTruthy()

    // Second capture must NOT overwrite (first-touch semantics).
    window.history.replaceState({}, '', '/opportunities?utm_source=google')
    const ft2 = captureFirstTouch()
    expect(ft2.first_source).toBe('linkedin')
    expect(getFirstTouch()?.first_source).toBe('linkedin')
  })
})

describe('analyticsIdentity — automated-traffic marking', () => {
  // QA 2026-07-27: GA4 and PostHog refuse automated browsers, but the DB
  // pipeline accepted them, so E2E/QA runs polluted the table every funnel
  // number is computed from (one 24-min QA session = 69 events).
  it('stamps is_automated only when navigator.webdriver is true', () => {
    Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true })
    expect(analyticsContext().is_automated).toBe(true)

    Object.defineProperty(window.navigator, 'webdriver', { value: false, configurable: true })
    expect(analyticsContext().is_automated).toBeUndefined()
  })
})

describe('analyticsIdentity — context bundle', () => {
  it('emits the full stampable context', () => {
    setUA('Mozilla/5.0 (Macintosh) Chrome/120 Safari')
    const ctx = analyticsContext()
    expect(ctx.session_id).toBeTruthy()
    expect(ctx.anonymous_id).toBeTruthy()
    expect(ctx.device).toBe('desktop')
    expect(ctx.browser).toBe('chrome')
    expect(typeof ctx.referrer_source).toBe('string')
  })
})
