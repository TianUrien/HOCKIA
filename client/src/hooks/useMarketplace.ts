import { useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Browser } from '@capacitor/browser'
import { useAuthStore } from '@/lib/auth'
import { IS_NATIVE } from '@/lib/isNative'
import { normalizeOfferLink } from '@/lib/brandOffers'
import { fetchMarketplace, trackItemOpen, type MarketItem, type MarketSurface } from '@/lib/marketplace'

/** Items for one country (null = the member's base country). */
export function useMarketplace(countryId: number | null) {
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  return useQuery({
    queryKey: ['marketplace', user?.id ?? 'anon', countryId ?? 'base'],
    queryFn: () => fetchMarketplace(countryId),
    enabled: Boolean(user) && role !== null && role !== 'brand',
    staleTime: 60_000,
    retry: false,
  })
}

/** The country being browsed: ?near=<id>, else the member's base country. */
export function useMarketCountry(): [number | null, (id: number) => void] {
  const [params, setParams] = useSearchParams()
  const base = useAuthStore((s) => s.profile?.base_country_id ?? null)
  const near = Number(params.get('near'))
  const set = useCallback((id: number) => {
    const next = new URLSearchParams(params)
    if (id === base) next.delete('near')
    else next.set('near', String(id))
    setParams(next, { replace: true })
  }, [params, setParams, base])
  return [Number.isFinite(near) && near > 0 ? near : base, set]
}

/** Offers open their detail; products open the brand's own store (no checkout in HOCKIA). */
export function useOpenMarketItem(surface: MarketSurface) {
  const navigate = useNavigate()
  return useCallback(async (item: MarketItem) => {
    trackItemOpen(item, surface)
    if (item.kind === 'offer') { navigate(`/offers/${item.id}`, { state: { surface } }); return }
    const link = normalizeOfferLink(item.link_url)
    if (!link) { navigate(`/brands/${item.brand_slug}`); return }
    if (IS_NATIVE) await Browser.open({ url: link })
    else window.open(link, '_blank', 'noopener,noreferrer')
  }, [navigate, surface])
}
