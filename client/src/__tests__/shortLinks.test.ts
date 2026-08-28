import { describe, expect, it } from 'vitest'
import {
  buildShortLinkTarget, isShortLinkPath, isValidDestination, shortLinkCode, suggestCode, isIOSUserAgent,
  APP_STORE_URL,
} from '@/lib/shortLinks'

const ig = { code: 'ig', destination: '/', utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'bio' }

describe('short-link paths', () => {
  it('recognises /l/<code> and nothing else', () => {
    expect(shortLinkCode('/l/ig')).toBe('ig')
    expect(shortLinkCode('/l/IG-App/')).toBe('ig-app')
    expect(isShortLinkPath('/l/')).toBe(false)
    expect(isShortLinkPath('/l/a')).toBe(false) // too short
    expect(isShortLinkPath('/login')).toBe(false)
    expect(isShortLinkPath('/l/ig/extra')).toBe(false)
  })
})

describe('buildShortLinkTarget', () => {
  it('an in-app destination becomes an SPA navigation carrying utm + hk_link', () => {
    const t = buildShortLinkTarget(ig, { isIOS: false })
    expect(t.external).toBe(false)
    expect(t.url).toBe('/?utm_source=instagram&utm_medium=social&utm_campaign=bio&hk_link=ig')
  })

  it('keeps existing query strings and hashes on the destination', () => {
    const t = buildShortLinkTarget({ ...ig, destination: '/opportunities?role=player#top' }, { isIOS: false })
    expect(t.url).toBe('/opportunities?role=player&utm_source=instagram&utm_medium=social&utm_campaign=bio&hk_link=ig#top')
  })

  it('omits empty utm fields', () => {
    const t = buildShortLinkTarget({ code: 'qr', destination: '/', utm_source: 'qr', utm_medium: null, utm_campaign: null }, { isIOS: false })
    expect(t.url).toBe('/?utm_source=qr&hk_link=qr')
  })

  it('"store" on iOS goes to the App Store', () => {
    const t = buildShortLinkTarget({ ...ig, code: 'ig-app', destination: 'store' }, { isIOS: true })
    expect(t.external).toBe(true)
    expect(t.url.startsWith(APP_STORE_URL)).toBe(true)
  })

  it('"store" elsewhere goes to Play with the utm set inside the install referrer', () => {
    const t = buildShortLinkTarget({ ...ig, code: 'ig-app', destination: 'store' }, { isIOS: false })
    const u = new URL(t.url)
    expect(u.hostname).toBe('play.google.com')
    expect(u.searchParams.get('id')).toBe('com.inhockia.app')
    const referrer = new URLSearchParams(u.searchParams.get('referrer') ?? '')
    expect(referrer.get('utm_source')).toBe('instagram')
    expect(referrer.get('utm_campaign')).toBe('bio')
    expect(referrer.get('hk_link')).toBe('ig-app')
    // and NOT leaked as top-level query params, where Play would drop them
    expect(u.searchParams.get('utm_source')).toBeNull()
  })

  it('an explicit Play URL gets the same referrer treatment', () => {
    const t = buildShortLinkTarget({ ...ig, destination: 'https://play.google.com/store/apps/details?id=com.inhockia.app&hl=es' }, { isIOS: false })
    const u = new URL(t.url)
    expect(u.searchParams.get('hl')).toBe('es')
    expect(new URLSearchParams(u.searchParams.get('referrer') ?? '').get('hk_link')).toBe('ig')
  })

  it('any other external https destination gets utm appended', () => {
    const t = buildShortLinkTarget({ ...ig, destination: 'https://inhockia.com/about' }, { isIOS: false })
    expect(t.external).toBe(true)
    expect(t.url).toBe('https://inhockia.com/about?utm_source=instagram&utm_medium=social&utm_campaign=bio&hk_link=ig')
  })
})

describe('validation helpers', () => {
  it('accepts in-app paths, https URLs and the store keyword only', () => {
    expect(isValidDestination('/')).toBe(true)
    expect(isValidDestination('/opportunities')).toBe(true)
    expect(isValidDestination('store')).toBe(true)
    expect(isValidDestination('https://inhockia.com')).toBe(true)
    expect(isValidDestination('http://inhockia.com')).toBe(false)
    expect(isValidDestination('//evil.com')).toBe(false)
    expect(isValidDestination('javascript:alert(1)')).toBe(false)
    expect(isValidDestination('')).toBe(false)
  })

  it('suggests a code from a label', () => {
    expect(suggestCode('Instagram bio')).toBe('instagram-bio')
    expect(suggestCode('  Café — Buenos Aires!! ')).toBe('cafe-buenos-aires')
    expect(suggestCode('x'.repeat(50))).toHaveLength(32)
  })

  it('detects iOS user agents, including iPadOS desktop-class UA', () => {
    expect(isIOSUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIOSUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(false)
    expect(isIOSUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false)
  })
})
