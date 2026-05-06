import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildProfileUrl,
  getShareOrigin,
  shareMessage,
  shareEmail,
  whatsappShareUrl,
  mailtoShareUrl,
  type ShareableRole,
} from '@/lib/profileShare'
import { Capacitor } from '@capacitor/core'

const ORIGIN = 'https://inhockia.com'

describe('buildProfileUrl', () => {
  it.each<[ShareableRole, string]>([
    ['player', '/players'],
    ['coach', '/coaches'],
    ['club', '/clubs'],
    ['umpire', '/umpires'],
    ['brand', '/brands'],
  ])('uses /%s base path for role %s', (role, base) => {
    expect(buildProfileUrl({ role, username: 'janed', id: 'uuid-1' }, ORIGIN))
      .toBe(`${ORIGIN}${base}/janed`)
  })

  it('falls back to id/<uuid> when username is missing', () => {
    expect(buildProfileUrl({ role: 'player', username: null, id: 'abc-123' }, ORIGIN))
      .toBe(`${ORIGIN}/players/id/abc-123`)
  })
})

describe('role-specific share copy', () => {
  it.each<ShareableRole>(['player', 'coach', 'umpire', 'club', 'brand'])(
    'shareMessage(%s) embeds the URL and says HOCKIA', (role) => {
      const url = `${ORIGIN}/players/janed`
      const msg = shareMessage(role, url)
      expect(msg).toContain(url)
      expect(msg).toContain('HOCKIA')
    }
  )

  it('individual roles use first-person ("my")', () => {
    expect(shareMessage('player', 'X')).toMatch(/\bmy\b/i)
    expect(shareMessage('coach', 'X')).toMatch(/\bmy\b/i)
    expect(shareMessage('umpire', 'X')).toMatch(/\bmy\b/i)
  })

  it('org roles use first-person plural ("our")', () => {
    expect(shareMessage('club', 'X')).toMatch(/\bour\b/i)
    expect(shareMessage('brand', 'X')).toMatch(/\bour\b/i)
  })

  it('shareEmail returns subject + body, with the URL in the body', () => {
    const { subject, body } = shareEmail('player', 'https://x.test/p/1')
    expect(subject).toContain('HOCKIA')
    expect(body).toContain('https://x.test/p/1')
  })
})

describe('whatsappShareUrl', () => {
  it('builds a wa.me URL with URL-encoded text containing the profile URL', () => {
    const url = `${ORIGIN}/players/janed`
    const wa = whatsappShareUrl('player', url)
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true)
    // The encoded URL should appear inside the encoded text payload
    expect(wa).toContain(encodeURIComponent(url))
    // Spaces must be %20 (not +) — wa.me normalises but explicit is safer
    expect(wa).toContain('%20')
  })

  it('encodes special characters in the role-specific message', () => {
    // The em-dash, apostrophe, and curly quote in our copy must round-trip
    const wa = whatsappShareUrl('coach', 'https://x.test/c/1')
    const decoded = decodeURIComponent(wa.split('text=')[1])
    expect(decoded).toContain('—')
    expect(decoded).toContain('https://x.test/c/1')
  })
})

describe('getShareOrigin (Capacitor native vs web)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns window.location.origin on web (non-native)', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false)
    // jsdom default origin is "http://localhost:3000" — what we use here
    // is whatever the test runner reports; just assert it matches window.
    expect(getShareOrigin()).toBe(window.location.origin)
  })

  it('returns the canonical https://inhockia.com when running inside Capacitor', () => {
    // Without this, links shared from the iOS/Android app would be
    // capacitor://localhost/... — broken for every external recipient.
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    expect(getShareOrigin()).toBe('https://inhockia.com')
  })

  it('produces a valid HTTPS profile URL when called from native', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const url = buildProfileUrl(
      { role: 'player', username: 'janed', id: 'uuid-1' },
      getShareOrigin(),
    )
    expect(url).toBe('https://inhockia.com/players/janed')
    expect(url.startsWith('capacitor://')).toBe(false)
    expect(url.startsWith('http://localhost')).toBe(false)
  })
})

describe('mailtoShareUrl', () => {
  it('builds a mailto: URL with subject and body params', () => {
    const url = `${ORIGIN}/players/janed`
    const mt = mailtoShareUrl('player', url)
    expect(mt.startsWith('mailto:?subject=')).toBe(true)
    expect(mt).toContain('&body=')
    expect(mt).toContain(encodeURIComponent(url))
  })

  it('encodes newlines so the email body keeps its line breaks', () => {
    const mt = mailtoShareUrl('club', 'https://x.test/c/1')
    // %0A is the encoded line-feed; our body uses real \n separators
    expect(mt).toContain('%0A')
  })

  it('does not produce a "+" character where a space should be', () => {
    // URLSearchParams encodes spaces as `+`, which mail clients render
    // literally. Our builder uses encodeURIComponent which yields %20.
    const mt = mailtoShareUrl('umpire', 'https://x.test/u/1')
    const bodyPart = mt.split('&body=')[1]
    expect(bodyPart).not.toMatch(/\+/)
  })
})
