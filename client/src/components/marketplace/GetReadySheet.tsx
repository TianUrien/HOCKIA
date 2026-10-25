import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { countryInSentence } from '@/lib/brandOffers'
import { trackMarket } from '@/lib/marketplace'
import { useOpenMarketItem } from '@/hooks/useMarketplace'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { BrandLogo, OfferHero } from '@/components/offers/OfferVisuals'
import { useGetReady } from './getReadyStore'

/** MK4: mounted once for the app; opened by maybeShowGetReady. */
export function GetReadySheet() {
  const { open, clubName, countryId, countryName, items, close } = useGetReady()
  const navigate = useNavigate()
  const openItem = useOpenMarketItem('moment_sheet')
  useEffect(() => { if (open) trackMarket('moment_sheet_view', { country: countryId, items: items.length }) }, [open, countryId, items.length])
  if (!open) return null
  const where = countryInSentence(countryName)
  return (
    <BottomSheet open={open} onClose={() => { trackMarket('moment_sheet_action', { action: 'dismiss', country: countryId }); close() }} ariaLabel={`Get ready for ${where}`} initialFocus="panel">
      <div className="px-5 pb-2" data-testid="get-ready-sheet">
        <p className="rounded-[14px] bg-status-positive-soft px-4 py-2.5 text-row font-semibold text-status-positive">Application sent to {clubName}</p>
        <h2 className="mt-4 text-title text-ink-1">Get ready for {where}</h2>
        <p className="mt-1 text-row text-ink-2">Things players sort out before moving. Only if they help you.</p>
        <div className="mt-4 space-y-2">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => { trackMarket('moment_sheet_action', { action: 'open_item', country: countryId }); close(); void openItem(it) }}
              className="flex w-full items-center gap-3 rounded-[16px] bg-surface-subtle p-3 text-left"
              data-testid="get-ready-item"
            >
              <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[12px]">
                <OfferHero url={it.image_url} className="absolute inset-0 h-full w-full" />
                {!it.image_url ? <span className="absolute inset-0 flex items-center justify-center"><BrandLogo name={it.brand_name} url={it.brand_logo_url} className="h-8 w-8 rounded-[8px]" initialsClassName="text-[11px]" /></span> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-ink-1">{it.title}</span>
                <span className="block truncate text-row text-ink-2">{it.brand_name}{it.kind === 'offer' ? ' · Offer for members' : ''}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" />
            </button>
          ))}
        </div>
        <Button block variant="tonal" className="mt-4 rounded-full" onClick={() => { trackMarket('moment_sheet_action', { action: 'see_all', country: countryId }); close(); navigate(`/community/brands/need/moving_abroad?near=${countryId}`) }} data-testid="get-ready-see-all">
          See everything for {where}
        </Button>
        <button type="button" onClick={() => { trackMarket('moment_sheet_action', { action: 'not_now', country: countryId }); close() }} className="mt-1 flex h-11 items-center text-body text-ink-2" data-testid="get-ready-not-now">Not now</button>
      </div>
    </BottomSheet>
  )
}
