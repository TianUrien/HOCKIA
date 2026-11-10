import { describe, expect, it, vi } from 'vitest'
import { countryForCode, fetchConnectionCountryCode } from '@/lib/connectionCountry'

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

describe('connection country hint (2026-11-09)', () => {
  it('reads a two-letter code from /api/geo', async () => {
    const f = ok({ country: 'NZ' })
    expect(await fetchConnectionCountryCode(f)).toBe('NZ')
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/geo')
  })
  it('anything else is null: no country, a bad value, an error, a failed request', async () => {
    expect(await fetchConnectionCountryCode(ok({ country: null }))).toBeNull()
    expect(await fetchConnectionCountryCode(ok({ country: 'new zealand' }))).toBeNull()
    expect(await fetchConnectionCountryCode(vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toBeNull()
    expect(await fetchConnectionCountryCode(vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })
  it('maps the code to the countries row', () => {
    const countries = [{ id: 7, code: 'NZ', code_alpha3: 'NZL', name: 'New Zealand', common_name: null, nationality_name: 'New Zealander', region: 'Oceania', flag_emoji: null }]
    expect(countryForCode('nz', countries)?.id).toBe(7)
    expect(countryForCode('GB', countries)).toBeNull()
    expect(countryForCode(null, countries)).toBeNull()
  })
})
