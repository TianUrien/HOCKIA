import { describe, expect, it } from 'vitest'
import { tagOutboundLink } from '@/lib/outboundLink'

// Store links from offers and products carry UTM tags (brand evaluation 2026-11-07, P0).
describe('tagOutboundLink', () => {
  it('adds source, medium, a readable campaign and the surface', () => {
    const u = new URL(tagOutboundLink('https://shop.example.com/gk', 'offer', '15% off Goalkeeper kits!', 'home_rail'))
    expect(u.searchParams.get('utm_source')).toBe('hockia')
    expect(u.searchParams.get('utm_medium')).toBe('offer')
    expect(u.searchParams.get('utm_campaign')).toBe('15-off-goalkeeper-kits')
    expect(u.searchParams.get('utm_content')).toBe('home_rail')
    expect(u.pathname).toBe('/gk')
  })
  it('keeps the brand’s own tags and other parameters', () => {
    const u = new URL(tagOutboundLink('https://shop.example.com/?ref=x&utm_campaign=spring', 'product', 'Stick', 'marketplace'))
    expect(u.searchParams.get('utm_campaign')).toBe('spring')
    expect(u.searchParams.get('ref')).toBe('x')
    expect(u.searchParams.get('utm_source')).toBe('hockia')
  })
  it('falls back to the kind when there is no title, and leaves bad URLs alone', () => {
    expect(new URL(tagOutboundLink('https://a.example.com', 'product', null, 'x')).searchParams.get('utm_campaign')).toBe('product')
    expect(tagOutboundLink('not a url', 'offer', 't', 'x')).toBe('not a url')
  })
})
