import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, MoreHorizontal, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { searchCountries } from '@/lib/countrySearch'
import { useCountries } from '@/hooks/useCountries'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { fieldInput } from '@/components/ui/fieldClasses'
import { BrandLogo, OfferHero } from '@/components/offers/OfferVisuals'
import { dismissOffer, hideBrandOffers } from '@/lib/memberOffers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { suggestBrand, trackItemImpression, trackMarket, type MarketItem, type MarketSurface } from '@/lib/marketplace'

/** Shared pieces of the Marketplace (Figma 08 · Brands P6: MK1–MK4). */

/** 50 % visible for 1 s, once (the impression rule, founder 2026-10-25). */
function useSeenOnce<T extends HTMLElement>(onSeen: () => void) {
  const ref = useRef<T>(null)
  const cb = useRef(onSeen)
  cb.current = onSeen
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        if (!timer) timer = setTimeout(() => { cb.current(); io.disconnect() }, 1000)
      } else if (timer) { clearTimeout(timer); timer = null }
    }, { threshold: [0, 0.5, 1] })
    io.observe(el)
    return () => { io.disconnect(); if (timer) clearTimeout(timer) }
  }, [])
  return ref
}

function ItemImage({ item, className, logoClassName, eager }: { item: MarketItem; className: string; logoClassName: string; eager?: boolean }) {
  return (
    <span className={cn('relative block overflow-hidden', className)}>
      <OfferHero url={item.image_url} className="absolute inset-0 h-full w-full" />
      {!item.image_url ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <BrandLogo name={item.brand_name} url={item.brand_logo_url} className={logoClassName} initialsClassName="text-[14px]" eager={eager} />
        </span>
      ) : null}
    </span>
  )
}

export function OfferPill({ className }: { className?: string }) {
  return <span className={cn('rounded-full bg-brand-soft px-2.5 py-0.5 text-caption font-semibold text-brand-primary', className)}>Offer</span>
}

/** Rail tile (MK1): 200 pt for offers, 160 pt for the need rails. */
export function MarketTile({ item, wide = false, surface, onOpen, onMenu }: { item: MarketItem; wide?: boolean; surface: MarketSurface; onOpen: () => void; onMenu: () => void }) {
  const ref = useSeenOnce<HTMLDivElement>(() => trackItemImpression(item, surface))
  return (
    <div ref={ref} className={cn('relative shrink-0 snap-start overflow-hidden rounded-[20px] border border-line bg-white', wide ? 'w-[200px]' : 'w-[160px]')} onContextMenu={(e) => { e.preventDefault(); onMenu() }} data-testid="market-tile" data-kind={item.kind}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <span className="relative block">
          <ItemImage item={item} className={wide ? 'h-[150px] w-full' : 'h-[120px] w-full'} logoClassName="h-12 w-12 rounded-[12px] shadow-[0_2px_10px_rgba(15,15,20,0.18)]" />
          {item.kind === 'offer' ? <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-caption font-semibold text-brand-primary">Offer</span> : null}
        </span>
        <span className="block p-2.5">
          <span className="block truncate text-caption text-ink-2">{item.brand_name}</span>
          <span className="mt-0.5 block text-row font-semibold leading-[19px] text-ink-1 line-clamp-2">{item.title}</span>
        </span>
      </button>
      <button type="button" onClick={onMenu} aria-label={`Options for ${item.title}`} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm"><MoreHorizontal className="h-4 w-4" /></span>
      </button>
    </div>
  )
}

/** List row (MK2 / MK3): thumb, title, brand · detail, Offer pill. */
export function MarketRow({ item, surface, detail, onOpen, onMenu }: { item: MarketItem; surface: MarketSurface; detail?: string | null; onOpen: () => void; onMenu: () => void }) {
  const ref = useSeenOnce<HTMLDivElement>(() => trackItemImpression(item, surface))
  const line = [item.brand_name, detail ?? (item.body ? item.body.split(/[.\n]/)[0].trim() : null)].filter(Boolean).join(' · ')
  return (
    <div ref={ref} className="flex items-center gap-3 rounded-[20px] bg-white p-3 shadow-[0_1px_2px_rgba(15,15,20,0.06)]" onContextMenu={(e) => { e.preventDefault(); onMenu() }} data-testid="market-row" data-kind={item.kind}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <ItemImage item={item} className="h-16 w-16 shrink-0 rounded-[14px]" logoClassName="h-10 w-10 rounded-[10px] shadow-[0_2px_10px_rgba(15,15,20,0.18)]" eager />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold leading-[22px] text-ink-1 line-clamp-2">{item.title}</span>
          <span className="mt-0.5 block text-row text-ink-2 line-clamp-2">{line}</span>
        </span>
      </button>
      {item.kind === 'offer' ? <OfferPill className="shrink-0" /> : null}
      <button type="button" onClick={onMenu} aria-label={`Options for ${item.title}`} className="-mr-1 flex h-11 w-9 shrink-0 items-center justify-center text-ink-3">
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  )
}

/** "Not useful" / "Hide this brand", the same everywhere offers and products show. */
export function ItemMenuSheet({ item, surface, onClose, onRemoved }: { item: MarketItem | null; surface: MarketSurface; onClose: () => void; onRemoved: (item: MarketItem, wholeBrand: boolean) => void }) {
  const run = async (hideBrand: boolean) => {
    if (!item) return
    onClose()
    onRemoved(item, hideBrand)
    try {
      if (item.kind === 'offer') {
        trackDbEvent('brand_offer_dismiss', 'brand_offer', item.id, { offer_id: item.id, surface, ...(hideBrand ? { reason: 'hide_brand' } : {}) })
        await dismissOffer(item.id, hideBrand ? 'hide_brand' : null)
      } else {
        trackDbEvent('brand_product_dismiss', 'brand_product', item.id, { brand_id: item.brand_id, surface, ...(hideBrand ? { reason: 'hide_brand' } : {}) })
        if (hideBrand) await hideBrandOffers(item.brand_id)
      }
    } catch (err) {
      logger.error('[Marketplace] hide failed', err)
    }
  }
  return (
    <BottomSheet open={item !== null} onClose={onClose} ariaLabel="Item options">
      {item ? (
        <div className="px-5 pb-2" data-testid="market-item-menu">
          <p className="text-row text-ink-2">{item.brand_name}</p>
          <p className="text-body font-semibold text-ink-1">{item.title}</p>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            <li><button type="button" onClick={() => void run(false)} className="block w-full py-3.5 text-left text-body text-ink-1">Not useful</button></li>
            <li><button type="button" onClick={() => void run(true)} className="block w-full py-3.5 text-left text-body text-ink-1">Hide this brand</button></li>
          </ul>
        </div>
      ) : null}
    </BottomSheet>
  )
}

/** "Near you England ▾" / "Moving to Germany ▾": switch the country. */
export function CountryChip({ label, countryId, tone = 'outline', onChange }: { label: string; countryId: number | null; tone?: 'outline' | 'soft'; onChange: (id: number) => void }) {
  const { countries, getCountryById } = useCountries()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const current = countryId != null ? getCountryById(countryId) : undefined
  const results = useMemo(() => searchCountries(countries, q).slice(0, 80), [countries, q])
  return (
    <div className="flex items-center gap-2">
      <span className="text-row text-ink-2">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('inline-flex h-11 items-center gap-1 rounded-full px-4 text-row font-semibold', tone === 'soft' ? 'bg-brand-soft text-brand-primary' : 'border border-line bg-white text-ink-1')}
        data-testid="market-country-chip"
      >
        {current ? (current.common_name || current.name) : 'Choose a country'}
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      <BottomSheet open={open} onClose={() => { setOpen(false); setQ('') }} ariaLabel="Choose a country">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">Choose a country</h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search countries" aria-label="Search countries" className={cn(fieldInput, 'pl-10')} />
          </div>
        </div>
        <ul className="max-h-[50dvh] overflow-y-auto px-2 pb-3">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onChange(c.id); setOpen(false); setQ('') }} className="flex h-12 w-full items-center rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted">
                {c.common_name || c.name}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  )
}

/** "Suggest a brand" (MK3): a short form that reaches the admins only. */
export function SuggestBrandSheet({ open, countryId, onClose }: { open: boolean; countryId: number | null; onClose: () => void }) {
  const addToast = useToastStore((s) => s.addToast)
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  useEffect(() => { if (open) { setName(''); setLink(''); setNote(''); setMissing(false) } }, [open])
  const send = async () => {
    if (!name.trim()) { setMissing(true); return }
    setBusy(true)
    try {
      await suggestBrand(name, link, countryId, note)
      trackMarket('brand_suggest', { country: countryId })
      addToast('Thanks. We’ll look into it.', 'success')
      onClose()
    } catch (err) {
      logger.error('[Marketplace] suggest failed', err)
      addToast('Could not send it. Please try again.', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Suggest a brand">
      <div className="space-y-3 px-5 pb-3" data-testid="suggest-brand-sheet">
        <h2 className="text-title text-ink-1">Suggest a brand</h2>
        <p className="text-row text-ink-2">Tell us who should be here. Only the Hockia team sees this.</p>
        <input value={name} onChange={(e) => { setName(e.target.value.slice(0, 80)); setMissing(false) }} placeholder="Brand or service name" aria-label="Brand or service name" aria-invalid={missing || undefined} aria-describedby={missing ? 'suggest-brand-name-hint' : undefined} className={fieldInput} data-testid="suggest-brand-name" />
        {missing ? <p id="suggest-brand-name-hint" role="alert" className="-mt-1 text-row text-ink-2">Add a brand or service name</p> : null}
        <input value={link} onChange={(e) => setLink(e.target.value.slice(0, 300))} placeholder="Website (optional)" aria-label="Website" inputMode="url" autoCapitalize="none" className={fieldInput} />
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="What do they offer? (optional)" aria-label="What do they offer" className={fieldInput} />
        <Button block className="rounded-full" loading={busy} onClick={() => void send()} data-testid="suggest-brand-send">Send suggestion</Button>
      </div>
    </BottomSheet>
  )
}
