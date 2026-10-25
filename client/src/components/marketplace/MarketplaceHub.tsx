import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth'
import { countryInSentence } from '@/lib/brandOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { useMyGoal } from '@/hooks/useMemberGoal'
import { useMarketCountry, useMarketplace, useOpenMarketItem } from '@/hooks/useMarketplace'
import { chipTone } from '@/components/ui/chipClasses'
import {
  LOW_SUPPLY,
  NEEDS,
  RAIL_MIN,
  distinctBrands,
  itemsByNeed,
  needOrder,
  sortForList,
  trackMarket,
  type MarketItem,
  type Need,
} from '@/lib/marketplace'
import { CountryChip, ItemMenuSheet, MarketRow, MarketTile, SuggestBrandSheet } from './MarketParts'

/**
 * The Marketplace hub above "All brands" on Community › Brands (Figma 08 ·
 * Brands P6: MK1, MK3). By need and by place: the country chip (the member's
 * base country unless they switch), need chips, "Offers for members", one
 * rail per need with 2+ items in the order the member most likely needs, and
 * an honest single list when a country has little supply. Never an empty
 * section or a placeholder.
 */
export function MarketplaceHub({ onItems }: { onItems?: (items: MarketItem[]) => void }) {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const [countryId, setCountry] = useMarketCountry()
  const { data } = useMarketplace(countryId)
  const goal = useMyGoal()
  const names = useCountryNames()
  const open = useOpenMarketItem('marketplace')
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [menuFor, setMenuFor] = useState<MarketItem | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const viewed = useRef<number | null | undefined>(undefined)

  const items = useMemo(() => (data ?? []).filter((i) => !gone.has(i.id)), [data, gone])
  useEffect(() => { onItems?.(items) }, [items, onItems])
  useEffect(() => {
    if (!data || viewed.current === countryId) return
    viewed.current = countryId
    trackMarket('marketplace_view', { country: countryId, need: 'all' })
  }, [data, countryId])

  if (role === 'brand' || !data) return null

  const country = countryId != null ? names([countryId])[0] ?? null : null
  const inCountry = country ? countryInSentence(country) : 'your country'
  const offers = items.filter((i) => i.kind === 'offer')
  const byNeed = itemsByNeed(items)
  const order = needOrder(role, goal.data?.options ?? [])
  const chips = NEEDS.filter((n) => (byNeed.get(n.key)?.length ?? 0) > 0)
  const low = items.length < LOW_SUPPLY

  const remove = (item: MarketItem, wholeBrand: boolean) =>
    setGone((prev) => new Set([...prev, ...(wholeBrand ? items.filter((x) => x.brand_id === item.brand_id).map((x) => x.id) : [item.id])]))
  const openNeed = (need: Need) => navigate(`/community/brands/need/${need}${countryId != null ? `?near=${countryId}` : ''}`)

  const header = (
    <div className="space-y-3">
      <CountryChip label="Near you" countryId={countryId} onChange={setCountry} />
      {!low && chips.length > 1 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="list" aria-label="Needs">
          <span role="listitem" className={cn('inline-flex h-11 shrink-0 items-center rounded-full px-4 text-row font-semibold', chipTone(true))}>All</span>
          {chips.map((n) => (
            <button key={n.key} type="button" role="listitem" onClick={() => openNeed(n.key)} className={cn('h-11 shrink-0 rounded-full px-4 text-row', chipTone(false))} data-testid={`market-need-chip-${n.key}`}>
              {n.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )

  const suggest = (
    <div className="pt-1">
      <p className="text-row text-ink-2">More brands are joining. Know one that should be here?</p>
      <button type="button" onClick={() => setSuggestOpen(true)} className="mt-1 flex h-11 items-center text-body font-semibold text-brand-primary" data-testid="market-suggest-brand">Suggest a brand</button>
    </div>
  )

  return (
    <section className="mb-6 space-y-6" aria-label="Marketplace" data-testid="marketplace-hub">
      {header}

      {items.length === 0 ? (
        <div data-testid="market-empty">
          <h2 className="text-title text-ink-1">Near you</h2>
          <p className="mt-0.5 text-row text-ink-2">No brands sell in {inCountry} yet.</p>
          {suggest}
        </div>
      ) : low ? (
        // MK3: little supply, one honest list.
        <div data-testid="market-low-supply">
          <h2 className="text-title text-ink-1">Near you</h2>
          <p className="mt-0.5 text-row text-ink-2">{distinctBrands(items)} {distinctBrands(items) === 1 ? 'brand sells' : 'brands sell'} in {inCountry} so far</p>
          <div className="mt-3 space-y-3">
            {sortForList(items).map((it) => (
              <MarketRow key={it.id} item={it} surface="marketplace" onOpen={() => void open(it)} onMenu={() => setMenuFor(it)} />
            ))}
          </div>
          <div className="mt-4">{suggest}</div>
        </div>
      ) : (
        <>
          {offers.length > 0 ? (
            <Rail title="Offers for members" subtitle={`Only on HOCKIA · ${country ?? ''}`.replace(/ · $/, '')} testId="market-rail-offers">
              {offers.map((it) => <MarketTile key={it.id} item={it} wide surface="marketplace" onOpen={() => void open(it)} onMenu={() => setMenuFor(it)} />)}
            </Rail>
          ) : null}
          {order.map((need) => {
            const list = byNeed.get(need) ?? []
            if (list.length < RAIL_MIN) return null
            const meta = NEEDS.find((n) => n.key === need)!
            return (
              <Rail key={need} title={meta.label} subtitle={meta.subtitle} onSeeAll={() => openNeed(need)} testId={`market-rail-${need}`}>
                {sortForList(list).map((it) => <MarketTile key={it.id} item={it} surface="marketplace" onOpen={() => void open(it)} onMenu={() => setMenuFor(it)} />)}
              </Rail>
            )
          })}
          {(() => {
            // Needs with a single item fold into one "Near you" list (MK1 rule 5).
            const singles = order.flatMap((n) => ((byNeed.get(n)?.length ?? 0) < RAIL_MIN ? byNeed.get(n) ?? [] : []))
            return singles.length > 0 ? (
              <div data-testid="market-near-you">
                <h2 className="text-title text-ink-1">Near you</h2>
                <div className="mt-3 space-y-3">
                  {singles.map((it) => <MarketRow key={it.id} item={it} surface="marketplace" onOpen={() => void open(it)} onMenu={() => setMenuFor(it)} />)}
                </div>
              </div>
            ) : null
          })()}
        </>
      )}

      <h2 className="text-title text-ink-1">All brands</h2>
      <ItemMenuSheet item={menuFor} surface="marketplace" onClose={() => setMenuFor(null)} onRemoved={remove} />
      <SuggestBrandSheet open={suggestOpen} countryId={countryId} onClose={() => setSuggestOpen(false)} />
    </section>
  )
}

function Rail({ title, subtitle, onSeeAll, testId, children }: { title: string; subtitle: string; onSeeAll?: () => void; testId: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} data-testid={testId}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title text-ink-1">{title}</h2>
          <p className="mt-0.5 truncate text-row text-ink-2">{subtitle}</p>
        </div>
        {onSeeAll ? <button type="button" onClick={onSeeAll} className="flex h-11 shrink-0 items-center text-row font-semibold text-brand-primary">See all</button> : null}
      </div>
      <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:px-0">
        {children}
      </div>
    </section>
  )
}
