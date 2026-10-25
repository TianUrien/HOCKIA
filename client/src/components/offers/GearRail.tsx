import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Browser } from '@capacitor/browser'
import { EyeOff, HelpCircle, MoreHorizontal } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { IS_NATIVE } from '@/lib/isNative'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { countryInSentence, normalizeOfferLink } from '@/lib/brandOffers'
import { dismissOffer, hideBrandOffers, trackImpressionOnce, trackOffer } from '@/lib/memberOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { useOffersForMe, useVisitId } from '@/hooks/useMemberOffers'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { MoreMenu } from '@/components/safety/MoreMenu'
import { MENU_ICON_CLASS } from '@/lib/report'
import { SectionHeader } from '@/components/home/v1/primitives'
import { MemberOfferCard } from './MemberOfferCard'
import { OfferHero } from './OfferVisuals'

/**
 * "Gear and deals near you" on Home (Figma page 02, YG: HR1; founder
 * 2026-10-25). Right after the roles carousel, once per visit. Up to six
 * tiles: eligible offers first (unseen first), then products from brands that
 * have a live offer in the member's country. Hidden below two tiles; with
 * exactly one offer and no products it falls back to the single offer card.
 * Replaces the single Phase 2 card in the feed.
 */

interface RailTile {
  kind: 'offer' | 'product'
  id: string
  brand_id: string
  brand_name: string
  brand_slug: string
  brand_logo_url: string | null
  brand_profile_id: string
  title: string
  image_url: string | null
  link_url: string | null
  member_country_id: number | null
}

const HIDE_KEY = 'hockia-home-rail-hidden-until'
const hiddenUntil = (): number => { try { return Number(localStorage.getItem(HIDE_KEY) ?? 0) } catch { return 0 } }

async function fetchRail(): Promise<RailTile[]> {
  const { data, error } = await supabase.rpc('get_home_gear_rail', { p_limit: 6 })
  if (error) throw error
  return (data ?? []) as unknown as RailTile[]
}

/** 50 % visible for 1 s (founder default 2026-10-25), once. */
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

export function GearRail() {
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const visitId = useVisitId()
  const names = useCountryNames()
  const [hidden, setHidden] = useState(() => hiddenUntil() > Date.now())
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [whyOpen, setWhyOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<RailTile | null>(null)
  const enabled = Boolean(user) && role !== null && role !== 'brand' && !hidden
  // Fixed for the visit: pull-to-refresh keeps the same tiles.
  const { data } = useQuery({ queryKey: ['home-gear-rail', user?.id ?? 'anon', visitId], queryFn: fetchRail, enabled, staleTime: Infinity, retry: false })
  const tiles = useMemo(() => (data ?? []).filter((t) => !gone.has(t.id)), [data, gone])
  // Exactly one offer and nothing else: the single offer card (H1) with its full text.
  const needSingle = tiles.length === 1 && tiles[0].kind === 'offer'
  const single = useOffersForMe(1, { enabled: enabled && needSingle, visitId })
  if (!enabled || !data) return null

  const country = tiles[0]?.member_country_id != null ? names([tiles[0].member_country_id])[0] ?? null : null
  const offers = tiles.filter((t) => t.kind === 'offer')
  const products = tiles.filter((t) => t.kind === 'product')

  if (tiles.length < 2) {
    const full = single.data?.[0]
    if (offers.length === 1 && products.length === 0 && full) {
      return (
        <div className="px-4 pb-4" data-testid="home-gear-single">
          <MemberOfferCard offer={full} surface="home" visitId={visitId} role={role} />
        </div>
      )
    }
    return null
  }

  const showFewer = () => {
    try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 86_400_000)) } catch { /* private mode */ }
    trackDbEvent('home_rail_hide', 'home_rail', undefined, { surface: 'home_rail', days: 7 })
    setHidden(true)
  }

  const removeTile = async (t: RailTile, hideBrand: boolean) => {
    setMenuFor(null)
    setGone((prev) => new Set([...prev, ...(hideBrand ? tiles.filter((x) => x.brand_id === t.brand_id).map((x) => x.id) : [t.id])]))
    try {
      if (t.kind === 'offer') {
        trackOffer('brand_offer_dismiss', t.id, 'home_rail', hideBrand ? { reason: 'hide_brand' } : undefined)
        await dismissOffer(t.id, hideBrand ? 'hide_brand' : null)
      } else {
        trackDbEvent('brand_product_dismiss', 'brand_product', t.id, { brand_id: t.brand_id, surface: 'home_rail', ...(hideBrand ? { reason: 'hide_brand' } : {}) })
        if (hideBrand) await hideBrandOffers(t.brand_id)
      }
    } catch (err) {
      logger.error('[GearRail] hide failed', err)
    }
  }

  return (
    <section className="flex flex-col gap-2 pb-4" aria-labelledby="home-gear-title" data-testid="home-gear-rail">
      <div className="flex items-start pr-2">
        <div className="min-w-0 flex-1">
          <SectionHeader title="Gear and deals near you" action="See all" to="/community/brands" className="pr-0" />
          <p id="home-gear-title" className="-mt-2 px-4 text-secondary text-ink-2">
            {country ? `From brands that sell in ${countryInSentence(country)}` : 'From brands that sell where you live'}
          </p>
        </div>
        <MoreMenu
          label="Gear and deals options"
          testId="home-gear-more"
          triggerClassName="flex h-11 w-11 items-center justify-center rounded-full text-ink-2"
          items={[
            { key: 'fewer', label: 'Show fewer of these', icon: <EyeOff className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: showFewer },
            { key: 'why', label: 'Why am I seeing this?', icon: <HelpCircle className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => setWhyOpen(true) },
          ]}
        />
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tiles.map((t) => (
          <Tile key={t.id} tile={t} visitId={visitId} onMenu={() => setMenuFor(t)} />
        ))}
      </div>

      <BottomSheet open={whyOpen} onClose={() => setWhyOpen(false)} ariaLabel="Why am I seeing this?">
        <div className="px-5 pb-3" data-testid="home-gear-why">
          <h2 className="text-title text-ink-1">Why am I seeing this?</h2>
          <p className="mt-2 text-body text-ink-2">Brands that sell where you live. Offers are picked by your country and role. Brands never see who you are.</p>
        </div>
      </BottomSheet>

      <BottomSheet open={menuFor !== null} onClose={() => setMenuFor(null)} ariaLabel="Tile options">
        {menuFor ? (
          <div className="px-5 pb-2" data-testid="home-gear-tile-menu">
            <p className="text-row text-ink-2">{menuFor.brand_name}</p>
            <p className="text-body font-semibold text-ink-1">{menuFor.title}</p>
            <ul className="mt-3 divide-y divide-line border-t border-line">
              <li><button type="button" onClick={() => void removeTile(menuFor, false)} className="block w-full py-3.5 text-left text-body text-ink-1">Not useful</button></li>
              <li><button type="button" onClick={() => void removeTile(menuFor, true)} className="block w-full py-3.5 text-left text-body text-ink-1">Hide this brand</button></li>
            </ul>
          </div>
        ) : null}
      </BottomSheet>
    </section>
  )
}

function Tile({ tile, visitId, onMenu }: { tile: RailTile; visitId: string; onMenu: () => void }) {
  const navigate = useNavigate()
  const ref = useSeenOnce<HTMLDivElement>(() => {
    if (tile.kind === 'offer') trackImpressionOnce(`${visitId}-rail`, tile.id, 'home_rail')
    else trackDbEvent('brand_product_impression', 'brand_product', tile.id, { brand_id: tile.brand_id, surface: 'home_rail' })
  })
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)

  const open = async () => {
    if (tile.kind === 'offer') {
      trackOffer('brand_offer_open', tile.id, 'home_rail')
      navigate(`/offers/${tile.id}`, { state: { surface: 'home_rail' } })
      return
    }
    trackDbEvent('brand_product_click', 'brand_product', tile.id, { brand_id: tile.brand_id, surface: 'home_rail' })
    const link = normalizeOfferLink(tile.link_url)
    if (!link) { navigate(`/brands/${tile.brand_slug}`); return }
    if (IS_NATIVE) await Browser.open({ url: link })
    else window.open(link, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      ref={ref}
      className="relative w-[150px] shrink-0 snap-start overflow-hidden rounded-[20px] border border-line bg-white"
      onContextMenu={(e) => { e.preventDefault(); onMenu() }}
      onPointerDown={() => { longPress.current = setTimeout(onMenu, 550) }}
      onPointerUp={() => { if (longPress.current) clearTimeout(longPress.current) }}
      onPointerLeave={() => { if (longPress.current) clearTimeout(longPress.current) }}
      data-testid="home-gear-tile"
      data-kind={tile.kind}
    >
      <button type="button" onClick={() => void open()} className="block w-full text-left">
        <span className="relative block h-[120px] w-full">
          <OfferHero url={tile.image_url} className="absolute inset-0 h-full w-full" />
          {tile.kind === 'offer' ? (
            <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-caption font-semibold text-brand-primary">Offer</span>
          ) : null}
        </span>
        <span className="block p-2.5 pr-8">
          <span className="block truncate text-caption text-ink-2">{tile.brand_name}</span>
          <span className="mt-0.5 block text-row font-semibold leading-[19px] text-ink-1 line-clamp-2">{tile.title}</span>
        </span>
      </button>
      <button type="button" onClick={onMenu} aria-label={`Options for ${tile.title}`} className="absolute bottom-1 right-0 flex h-11 w-9 items-center justify-center text-ink-3">
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  )
}
