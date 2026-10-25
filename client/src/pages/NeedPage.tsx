import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import Header from '@/components/Header'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { useAuthStore } from '@/lib/auth'
import { countryInSentence } from '@/lib/brandOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { useMarketCountry, useMarketplace, useOpenMarketItem } from '@/hooks/useMarketplace'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'
import { CountryChip, ItemMenuSheet, MarketRow, SuggestBrandSheet } from '@/components/marketplace/MarketParts'
import { NEEDS, isNeed, sortForList, trackMarket, type MarketItem } from '@/lib/marketplace'

/**
 * One need, one country (Figma 08 · Brands P6, MK2): offers first, then
 * products and services, newest first. "Moving to <Country>" on Moving
 * abroad. Ends with "Ask Hockia AI what to sort out for <Country>".
 */
export default function NeedPage() {
  const { need } = useParams()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const [countryId, setCountry] = useMarketCountry()
  const { data, isLoading } = useMarketplace(countryId)
  const names = useCountryNames()
  const open = useOpenMarketItem('need_page')
  const showAi = useHockiaAiSheet((s) => s.show)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [menuFor, setMenuFor] = useState<MarketItem | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const opened = useRef(false)

  const meta = NEEDS.find((n) => n.key === need)
  const list = useMemo(() => sortForList((data ?? []).filter((i) => i.need === need && !gone.has(i.id))), [data, need, gone])
  useEffect(() => {
    if (opened.current || !meta) return
    opened.current = true
    trackMarket('need_open', { need: meta.key, country: countryId })
  }, [meta, countryId])

  if (!isNeed(need) || !meta) return <Navigate to="/community/brands" replace />
  if (role === 'brand') return <Navigate to="/community/brands" replace />

  const country = countryId != null ? names([countryId])[0] ?? null : null
  const inCountry = country ? countryInSentence(country) : null
  const moving = meta.key === 'moving_abroad'

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="need-page">
      <Header mobileHidden />
      <DetailNavBar parent="Brands" fallbackPath="/community/brands" onBack={() => navigate(`/community/brands${countryId != null ? `?near=${countryId}` : ''}`)} />
      <main className="mx-auto max-w-[760px] px-4 pb-28 lg:pt-under-header-lg">
        <h1 className="text-title-xl text-ink-1">{meta.label}</h1>
        <p className="mt-1 text-body text-ink-2">{meta.pageSubtitle}</p>
        <div className="mt-4">
          <CountryChip label={moving ? 'Moving to' : 'Near you'} countryId={countryId} tone={moving ? 'soft' : 'outline'} onChange={setCountry} />
        </div>

        <div className="mt-5 space-y-3">
          {isLoading ? (
            [0, 1, 2].map((i) => <div key={i} className="h-[88px] animate-pulse rounded-[20px] bg-white" />)
          ) : list.length > 0 ? (
            list.map((it) => <MarketRow key={it.id} item={it} surface="need_page" onOpen={() => void open(it)} onMenu={() => setMenuFor(it)} />)
          ) : (
            <div className="rounded-[20px] bg-white p-5" data-testid="need-page-empty">
              <p className="text-body font-semibold text-ink-1">Nothing here{inCountry ? ` for ${inCountry}` : ''} yet</p>
              <p className="mt-1 text-row text-ink-2">More brands are joining. Know one that should be here?</p>
              <button type="button" onClick={() => setSuggestOpen(true)} className="mt-1 flex h-11 items-center text-body font-semibold text-brand-primary">Suggest a brand</button>
            </div>
          )}
        </div>

        {inCountry ? (
          <button
            type="button"
            onClick={() => showAi('header', 'chat', { text: moving ? `What should I sort out before moving to ${inCountry} to play?` : `What ${meta.label.toLowerCase()} do I need in ${inCountry}?`, send: false })}
            className="mt-5 flex w-full items-center rounded-full bg-brand-soft px-5 py-3.5 text-left text-body font-semibold text-brand-primary"
            data-testid="need-page-ask-ai"
          >
            Ask Hockia AI what to sort out for {inCountry}
          </button>
        ) : null}
      </main>
      <ItemMenuSheet item={menuFor} surface="need_page" onClose={() => setMenuFor(null)} onRemoved={(it, whole) => setGone((p) => new Set([...p, ...(whole ? list.filter((x) => x.brand_id === it.brand_id).map((x) => x.id) : [it.id])]))} />
      <SuggestBrandSheet open={suggestOpen} countryId={countryId} onClose={() => setSuggestOpen(false)} />
    </div>
  )
}
