import { describe, expect, it } from 'vitest'
import { normalizeAttribution, hostnameOf } from '@/lib/attributionRules'
import { ATTRIBUTION_CORPUS } from './fixtures/attributionCorpus'

/**
 * The normalization corpus. The SAME cases run against the SQL registry in
 * src/__tests__/db/attribution.test.ts — the two implementations must agree
 * on every line, or the client would label a touch one way and the server
 * would write it another.
 */
describe('normalizeAttribution (client mirror of the SQL registry)', () => {
  for (const [utm, host, source, discarded] of ATTRIBUTION_CORPUS) {
    it(`utm=${utm ?? '∅'} host=${host ?? '∅'} → ${discarded ? 'DISCARD' : source}`, () => {
      const n = normalizeAttribution(utm, host)
      expect(n.discarded).toBe(discarded)
      if (!discarded) expect(n.source).toBe(source)
    })
  }

  it('reports how the value was derived', () => {
    expect(normalizeAttribution('ig', null).method).toBe('utm')
    expect(normalizeAttribution(null, 'l.instagram.com').method).toBe('referrer')
    expect(normalizeAttribution(null, null).method).toBe('none')
  })

  it('groups AI assistants together and search engines together', () => {
    expect(normalizeAttribution(null, 'chatgpt.com').group).toBe('ai_assistant')
    expect(normalizeAttribution(null, 'www.perplexity.ai').group).toBe('ai_assistant')
    expect(normalizeAttribution(null, 'www.google.com').group).toBe('search')
    expect(normalizeAttribution('ig', null).group).toBe('social')
  })
})

describe('hostnameOf', () => {
  it('extracts the host from a URL and accepts bare hostnames', () => {
    expect(hostnameOf('https://www.google.com/search?q=hockia')).toBe('www.google.com')
    expect(hostnameOf('l.instagram.com')).toBe('l.instagram.com')
    expect(hostnameOf('')).toBeNull()
    expect(hostnameOf(null)).toBeNull()
    expect(hostnameOf('not a host!!')).toBeNull()
  })
})
