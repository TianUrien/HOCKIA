import type { Country } from '@/hooks/useCountries'
import { getSiteUrl, isNativeApp } from '@/lib/siteUrl'

/**
 * The country of the member's connection, from /api/geo (Vercel reads it from
 * the IP address). A hint only: VPNs and travel make it wrong, so it is shown
 * as a suggestion the member confirms, never saved on its own (founder
 * 2026-11-09). Any failure (local dev has no /api, offline, an ad blocker)
 * returns null and the card simply asks.
 */
export async function fetchConnectionCountryCode(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const url = isNativeApp() ? `${getSiteUrl()}/api/geo` : '/api/geo'
    const res = await fetcher(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const body = (await res.json()) as { country?: unknown }
    return typeof body.country === 'string' && /^[A-Z]{2}$/.test(body.country) ? body.country : null
  } catch {
    return null
  }
}

/** The countries row for an ISO code. Vercel says "GB" for the whole United Kingdom. */
export function countryForCode(code: string | null, countries: Country[]): Country | null {
  if (!code) return null
  return countries.find((c) => c.code.toUpperCase() === code.toUpperCase()) ?? null
}
