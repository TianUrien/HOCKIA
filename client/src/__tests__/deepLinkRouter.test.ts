import { describe, expect, it } from 'vitest'
import { resolveDeepLink } from '@/lib/deepLinkRouter'

describe('resolveDeepLink', () => {
  it('routes custom-scheme links with our host to the in-app path, keeping the query', () => {
    expect(resolveDeepLink('hockia://app.inhockia.com/opportunities?utm_source=ig&hk_link=ig')).toEqual({
      to: '/opportunities?utm_source=ig&hk_link=ig',
      url: 'hockia://app.inhockia.com/opportunities?utm_source=ig&hk_link=ig',
    })
  })

  it('treats a host-less or path-as-host custom link as a path', () => {
    expect(resolveDeepLink('hockia:///players/tian')?.to).toBe('/players/tian')
    expect(resolveDeepLink('hockia://players/tian')?.to).toBe('/players/tian')
    expect(resolveDeepLink('hockia://app.inhockia.com')?.to).toBe('/')
  })

  it('leaves the OAuth callback to the OAuth flow', () => {
    expect(resolveDeepLink('hockia://auth/callback?code=abc')).toBeNull()
    expect(resolveDeepLink('https://app.inhockia.com/auth/callback#access_token=x')).toBeNull()
  })

  it('routes universal links on our hosts and ignores everything else', () => {
    expect(resolveDeepLink('https://app.inhockia.com/l/ig')?.to).toBe('/l/ig')
    expect(resolveDeepLink('https://inhockia.com/opportunities/')?.to).toBe('/opportunities')
    expect(resolveDeepLink('https://evil.com/opportunities')).toBeNull()
    expect(resolveDeepLink('mailto:x@y.com')).toBeNull()
    expect(resolveDeepLink('not a url')).toBeNull()
    expect(resolveDeepLink(null)).toBeNull()
  })
})
