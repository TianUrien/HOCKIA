import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Browser } from '@capacitor/browser'
import { EyeOff, Info, MessageCircle, X } from 'lucide-react'
import Header from '@/components/Header'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { IS_NATIVE } from '@/lib/isNative'
import { cn } from '@/lib/utils'
import { normalizeOfferLink, shortDate } from '@/lib/brandOffers'
import { brandCategoryLabel } from '@/lib/identity'
import { resolveConversationRoute } from '@/lib/startConversation'
import { loadMessageDraft, saveMessageDraft } from '@/lib/messageDrafts'
import {
  detailReasonLine,
  hideBrandOffers,
  offerForLine,
  rememberOfferContact,
  storeLabel,
  trackOffer,
  type OfferSurface,
} from '@/lib/memberOffers'
import { useOfferDetail, useVisitId } from '@/hooks/useMemberOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { useFollowBrand } from '@/hooks/useFollowBrand'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MoreMenu } from '@/components/safety/MoreMenu'
import { useReportAction } from '@/components/safety/useReportAction'
import { MENU_ICON_CLASS } from '@/lib/report'
import { Button } from '@/components/ui/Button'
import { BrandLogo, OfferHero } from '@/components/offers/OfferVisuals'

/**
 * Offer detail (Figma "08 · Brands", P2: OD1 phone full screen, OD2 desktop).
 * Go to store opens the brand's link outside the app; Message opens the
 * conversation with "About: <offer>" ready in the composer. "Apply as
 * ambassador" shows only to players when the brand is open to partners; with
 * no player-initiated application flow yet, it opens a message prefilled with
 * the request.
 */
export default function OfferDetailPage() {
  const { offerId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const surface: OfferSurface = (location.state as { surface?: OfferSurface } | null)?.surface ?? 'offer_detail'
  const { user, profile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const visitId = useVisitId()
  const { data: offer, isLoading, isError } = useOfferDetail(offerId)
  const names = useCountryNames()
  const follow = useFollowBrand(offer?.brand_id)
  const report = useReportAction({ targetId: offer?.brand_profile_id, subject: 'offer', contentId: offer?.id })
  const opened = useRef(false)

  // A direct visit (shared link, notification) counts as an open from the detail itself.
  useEffect(() => {
    if (!offer || opened.current) return
    opened.current = true
    if (surface === 'offer_detail') trackOffer('brand_offer_open', offer.id, 'offer_detail', { visit: visitId })
  }, [offer, surface, visitId])

  const close = () => (window.history.length > 1 ? navigate(-1) : navigate('/home'))

  if (isLoading) return <div className="min-h-screen bg-surface-subtle" aria-busy="true" />
  if (isError || !offer) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-subtle px-6 text-center" data-testid="offer-detail-missing">
        <p className="text-title text-ink-1">This offer isn&rsquo;t available</p>
        <p className="text-row text-ink-2">It may have ended, or the brand paused it.</p>
        <Button variant="tonal" className="rounded-full" onClick={() => navigate('/home')}>Back to Home</Button>
      </div>
    )
  }

  const link = normalizeOfferLink(offer.link_url)
  const countries = names(offer.country_ids)
  const memberCountry = names(offer.member_country_id != null ? [offer.member_country_id] : [])[0] ?? null
  const brandCountry = names(offer.brand_country_id != null ? [offer.brand_country_id] : [])[0] ?? null
  const showAmbassador = offer.brand_open_to_partners && profile?.role === 'player'

  const goToStore = async () => {
    if (!link) return
    trackOffer('brand_offer_store_tap', offer.id, surface)
    if (IS_NATIVE) await Browser.open({ url: link })
    else window.open(link, '_blank', 'noopener,noreferrer')
  }

  const message = async (draft: string) => {
    if (!user) { navigate('/signup'); return }
    try {
      const route = await resolveConversationRoute(user.id, offer.brand_profile_id)
      const params = new URLSearchParams(route.split('?')[1] ?? '')
      const key = params.get('conversation') ?? `pending-${offer.brand_profile_id}`
      // Never overwrite something the member already started typing.
      if (!loadMessageDraft(user.id, key).trim()) saveMessageDraft(user.id, key, draft)
      rememberOfferContact(offer.brand_profile_id, offer.id, surface)
      navigate(route, { state: { returnTo: location.pathname, messageOrigin: 'Profile' } })
    } catch (err) {
      logger.error('[OfferDetail] open conversation failed', err)
      addToast('Could not open the conversation. Please try again.', 'error')
    }
  }

  const hideBrand = async () => {
    try {
      await hideBrandOffers(offer.brand_id)
      trackOffer('brand_offer_dismiss', offer.id, 'offer_detail', { reason: 'hide_brand' })
      addToast(`You won't see offers from ${offer.brand_name}.`, 'success')
      close()
    } catch (err) {
      logger.error('[OfferDetail] hide brand failed', err)
      addToast('Could not hide this brand. Please try again.', 'error')
    }
  }

  // No photo: the brand's logo on the gradient, so the hero never reads as a
  // missing image (design review 2026-10-25).
  const noPhotoLogo = offer.image_url ? null : (
    <span className="absolute inset-0 flex items-center justify-center" data-testid="offer-detail-hero-logo">
      <BrandLogo name={offer.brand_name} url={offer.brand_logo_url} className="h-[72px] w-[72px] rounded-[16px] shadow-[0_4px_16px_rgba(15,15,20,0.18)]" initialsClassName="text-[24px]" />
    </span>
  )

  const menu = (
    <MoreMenu
      label="Offer actions"
      testId="offer-detail-more"
      triggerClassName="flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm"
      items={[
        { key: 'hide', label: 'Hide this brand', icon: <EyeOff className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => void hideBrand() },
        { ...report.item, label: 'Report offer' },
      ]}
    />
  )

  const body = (
    <>
      <div className="flex items-start gap-3">
        <BrandLogo name={offer.brand_name} url={offer.brand_logo_url} className="h-14 w-14 shrink-0 rounded-[16px]" initialsClassName="text-[18px]" />
        <button type="button" onClick={() => navigate(`/brands/${offer.brand_slug}`)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-body font-semibold text-ink-1">{offer.brand_name}</span>
          <span className="block text-row text-ink-2">{[brandCategoryLabel(offer.brand_category), brandCountry].filter(Boolean).join(' · ')}</span>
        </button>
        {user ? (
          <button
            type="button"
            onClick={() => void follow.toggleFollow()}
            disabled={follow.isToggling}
            aria-pressed={follow.isFollowing}
            className="h-9 shrink-0 rounded-full bg-brand-soft px-4 text-row font-semibold text-brand-primary disabled:opacity-60"
            data-testid="offer-detail-follow"
          >
            {follow.isFollowing ? 'Following' : 'Follow'}
          </button>
        ) : null}
      </div>
      <h1 className="mt-4 text-title-xl text-ink-1">{offer.title}</h1>
      <p className="mt-3 whitespace-pre-line text-body text-ink-2">{offer.body}</p>

      <dl className="mt-5 grid grid-cols-[72px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-[20px] bg-white p-4 text-row shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
        <dt className="text-ink-2">For</dt>
        <dd className="text-ink-1">{offerForLine(offer.roles, countries)}{offer.area ? ` (${offer.area})` : ''}</dd>
        {offer.ends_at ? (<><dt className="text-ink-2">Until</dt><dd className="text-ink-1">{shortDate(offer.ends_at)} {new Date(offer.ends_at).getUTCFullYear()}</dd></>) : null}
        {link ? (<><dt className="text-ink-2">Store</dt><dd className="min-w-0 break-all text-ink-1">{storeLabel(link)}</dd></>) : null}
      </dl>

      <p className="mt-4 flex gap-2 px-1 text-row text-ink-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
        {detailReasonLine(offer.eligible ? memberCountry : null)}
      </p>

      {showAmbassador ? (
        <div className="mt-5 rounded-[24px] bg-brand-soft p-4" data-testid="offer-detail-ambassador">
          <p className="text-body font-semibold text-brand-primary">{offer.brand_name} is looking for ambassadors</p>
          <p className="mt-1 text-row text-brand-primary/90">Applying sends a message to the brand from your profile.</p>
          <button
            type="button"
            onClick={() => void message(`I'd like to be an ambassador for ${offer.brand_name}.`)}
            className="mt-3 inline-flex h-11 items-center rounded-full bg-white px-5 text-body font-semibold text-brand-primary"
          >
            Apply as ambassador
          </button>
        </div>
      ) : null}
    </>
  )

  if (!isPhone) {
    return (
      <div className="min-h-screen bg-surface-subtle" data-testid="offer-detail">
        <Header />
        <main className="mx-auto max-w-[920px] px-6 pb-16 pt-under-header-lg">
          <div className="overflow-hidden rounded-[28px] bg-surface-subtle shadow-[0_8px_30px_rgba(15,15,20,0.08)]">
            <div className={cn('relative', offer.image_url ? 'h-[280px]' : 'h-[180px]')}>
              <OfferHero url={offer.image_url} className="absolute inset-0 h-full w-full" />
              {noPhotoLogo}
              <button type="button" onClick={close} aria-label="Close" className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm"><X className="h-5 w-5" /></button>
              <div className="absolute right-4 top-4">{menu}</div>
            </div>
            <div className="p-8">
              {body}
              <div className="mt-6 flex gap-3">
                {link ? <Button className="rounded-full" onClick={() => void goToStore()} data-testid="offer-detail-store">Go to store</Button> : null}
                <Button variant="tonal" className="rounded-full" onClick={() => void message(`About: ${offer.title}\n`)} data-testid="offer-detail-message">Message {offer.brand_name}</Button>
              </div>
            </div>
          </div>
        </main>
        {report.sheet}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-subtle pb-[calc(env(safe-area-inset-bottom)+96px)]" data-testid="offer-detail">
      <div className={cn('relative', offer.image_url ? 'h-[250px]' : 'h-[160px]')}>
        <OfferHero url={offer.image_url} className="absolute inset-0 h-full w-full" />
        {noPhotoLogo}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <button type="button" onClick={close} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm"><X className="h-5 w-5" /></button>
          {menu}
        </div>
      </div>
      <div className="px-4 pt-5">{body}</div>
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-line bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        <button
          type="button"
          onClick={() => void message(`About: ${offer.title}\n`)}
          aria-label={`Message ${offer.brand_name}`}
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary"
          data-testid="offer-detail-message"
        >
          <MessageCircle className="h-6 w-6" strokeWidth={1.8} />
        </button>
        {link ? (
          <button type="button" onClick={() => void goToStore()} className={cn('flex h-[52px] flex-1 items-center justify-center rounded-full bg-brand-primary text-body font-semibold text-white')} data-testid="offer-detail-store">
            Go to store
          </button>
        ) : null}
      </div>
      {report.sheet}
    </div>
  )
}
