import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Check, Copy, ExternalLink, EyeOff, Info, MessageCircle, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import Header from '@/components/Header'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { openOutbound, tagOutboundLink } from '@/lib/outboundLink'
import { cn } from '@/lib/utils'
import { normalizeOfferLink, shortDate } from '@/lib/brandOffers'
import { brandCategoryLabel } from '@/lib/identity'
import { resolveConversationRoute } from '@/lib/startConversation'
import { loadMessageDraft, saveMessageDraft } from '@/lib/messageDrafts'
import {
  detailReasonLine,
  fetchOfferObjective,
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
import { useBrandsT } from '@/i18n/ns/brands'
import { isEnglish } from '@/i18n/format'
import { dayFirst } from '@/lib/dayFirst'

/**
 * Offer detail (Figma "08 · Brands", P2: OD1 phone full screen, OD2 desktop).
 * Go to store opens the brand's link outside the app; Message opens the
 * conversation with "About: <offer>" ready in the composer. "Apply as
 * ambassador" shows only to players when the brand is open to partners; with
 * no player-initiated application flow yet, it opens a message prefilled with
 * the request.
 */
export default function OfferDetailPage() {
  const t = useBrandsT()
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
  // What the brand asks for: "ask" puts the conversation first, not the store.
  const { data: objective = 'offer' } = useQuery({ queryKey: ['brand-offer-objective', offerId], queryFn: () => fetchOfferObjective(offerId as string), enabled: Boolean(offerId), staleTime: 300_000 })

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
        <p className="text-title text-ink-1">{t('offerDetail.missingTitle')}</p>
        <p className="text-row text-ink-2">{t('offerDetail.missingBody')}</p>
        <Button variant="tonal" className="rounded-full" onClick={() => navigate('/home')}>{t('offerDetail.backHome')}</Button>
      </div>
    )
  }

  const link = normalizeOfferLink(offer.link_url)
  const countries = names(offer.country_ids)
  const memberCountry = names(offer.member_country_id != null ? [offer.member_country_id] : [])[0] ?? null
  const brandCountry = names(offer.brand_country_id != null ? [offer.brand_country_id] : [])[0] ?? null
  const reasonLine = detailReasonLine(offer.eligible ? memberCountry : null, offer.everywhere ?? false)
  const showAmbassador = offer.brand_open_to_partners && profile?.role === 'player'
  // The conversation is the main action when the brand asked for questions,
  // and whenever the campaign has no link to open.
  const askFirst = objective === 'ask' || !link

  const goToStore = async () => {
    if (!link) return
    trackOffer('brand_offer_store_tap', offer.id, surface)
    await openOutbound(tagOutboundLink(link, 'offer', offer.title, surface))
  }

  const message = async (draft: string) => {
    if (!user) { navigate('/signup'); return }
    try {
      const route = await resolveConversationRoute(user.id, offer.brand_profile_id)
      const params = new URLSearchParams(route.split('?')[1] ?? '')
      const key = params.get('conversation') ?? `pending-${offer.brand_profile_id}`
      // Never overwrite something the member already started typing.
      if (!loadMessageDraft(user.id, key).trim()) saveMessageDraft(user.id, key, draft)
      rememberOfferContact(user.id, offer.brand_profile_id, offer.id, surface)
      navigate(route, { state: { returnTo: location.pathname, messageOrigin: 'Profile' } })
    } catch (err) {
      logger.error('[OfferDetail] open conversation failed', err)
      addToast(t('offerDetail.openFailed'), 'error')
    }
  }

  const hideBrand = async () => {
    try {
      await hideBrandOffers(offer.brand_id)
      trackOffer('brand_offer_dismiss', offer.id, 'offer_detail', { reason: 'hide_brand' })
      addToast(t('offerDetail.brandHidden', { brand: offer.brand_name }), 'success')
      close()
    } catch (err) {
      logger.error('[OfferDetail] hide brand failed', err)
      addToast(t('offerDetail.hideFailed'), 'error')
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
      label={t('offerDetail.actionsLabel')}
      testId="offer-detail-more"
      triggerClassName="flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm"
      items={[
        { key: 'hide', label: t('offerDetail.hideBrand'), icon: <EyeOff className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => void hideBrand() },
        { ...report.item, label: t('offerDetail.report') },
      ]}
    />
  )

  const body = (
    <>
      <div className="flex items-start gap-3">
        <BrandLogo name={offer.brand_name} url={offer.brand_logo_url} className="h-14 w-14 shrink-0 rounded-[16px]" initialsClassName="text-[18px]" />
        <button type="button" onClick={() => navigate(`/brands/${offer.brand_slug}`)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-body font-semibold text-ink-1">{offer.brand_name}</span>
          <span className="block text-row text-ink-2">{[brandCategoryLabel(offer.brand_category), brandCountry].filter(Boolean).join(', ')}</span>
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
            {follow.isFollowing ? t('offerDetail.following') : t('offerDetail.follow')}
          </button>
        ) : null}
      </div>
      {offer.perk ? <span className="mt-4 inline-block rounded-full bg-brand-soft px-3 py-1 text-row font-semibold text-brand-primary" data-testid="offer-detail-perk">{offer.perk}</span> : null}
      <h1 className={cn(offer.perk ? 'mt-2' : 'mt-4', 'text-title-xl text-ink-1')}>{offer.title}</h1>
      <p className="mt-3 whitespace-pre-line text-body text-ink-2">{offer.body}</p>

      {offer.promo_code ? <PromoCode code={offer.promo_code} onCopied={() => trackOffer('brand_offer_code_copy', offer.id, surface)} /> : null}

      <dl className="mt-5 grid grid-cols-[72px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-[20px] bg-white p-4 text-row shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
        <dt className="text-ink-2">{t('offerDetail.forLabel')}</dt>
        <dd className="text-ink-1">{offerForLine(offer.roles, countries, { everywhere: offer.everywhere, regions: offer.regions })}{offer.area ? ` (${offer.area})` : ''}</dd>
        {offer.ends_at ? (<><dt className="text-ink-2">{t('offerDetail.untilLabel')}</dt><dd className="text-ink-1">{isEnglish() ? `${shortDate(offer.ends_at)} ${new Date(offer.ends_at).getUTCFullYear()}` : dayFirst(offer.ends_at, { year: 'always' })}</dd></>) : null}
        {link ? (<><dt className="text-ink-2">{t('offerDetail.storeLabel')}</dt><dd className="min-w-0 break-all text-ink-1">{storeLabel(link)}</dd></>) : null}
      </dl>

      {reasonLine ? (
        <p className="mt-4 flex gap-2 px-1 text-row text-ink-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
          {reasonLine}
        </p>
      ) : null}

      {showAmbassador ? (
        <div className="mt-5 rounded-[24px] bg-brand-soft p-4" data-testid="offer-detail-ambassador">
          <p className="text-body font-semibold text-brand-primary">{t('offerDetail.ambassadorTitle', { brand: offer.brand_name })}</p>
          <p className="mt-1 text-row text-brand-primary/90">{t('offerDetail.ambassadorBody')}</p>
          <button
            type="button"
            onClick={() => void message(t('offerDetail.ambassadorDraft', { brand: offer.brand_name }))}
            className="mt-3 inline-flex h-11 items-center rounded-full bg-white px-5 text-body font-semibold text-brand-primary"
          >
            {t('offerDetail.ambassadorApply')}
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
              <button type="button" onClick={close} aria-label={t('offerDetail.close')} className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm"><X className="h-5 w-5" /></button>
              <div className="absolute right-4 top-4">{menu}</div>
            </div>
            <div className="p-8">
              {body}
              <div className="mt-6 flex gap-3">
                {askFirst ? (
                  <>
                    <Button className="rounded-full" onClick={() => void message(`${t('offerDetail.aboutDraft', { title: offer.title })}\n`)} data-testid="offer-detail-message">{t('offerDetail.askBrand', { brand: offer.brand_name })}</Button>
                    {link ? <Button variant="tonal" className="rounded-full" onClick={() => void goToStore()} data-testid="offer-detail-store">{t('offerDetail.openLink')}</Button> : null}
                  </>
                ) : (
                  <>
                    {link ? <Button className="rounded-full" onClick={() => void goToStore()} data-testid="offer-detail-store">{t('offerDetail.goToStore')}</Button> : null}
                    <Button variant="tonal" className="rounded-full" onClick={() => void message(`${t('offerDetail.aboutDraft', { title: offer.title })}\n`)} data-testid="offer-detail-message">{t('offerDetail.messageBrand', { brand: offer.brand_name })}</Button>
                  </>
                )}
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
          <button type="button" onClick={close} aria-label={t('offerDetail.close')} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm"><X className="h-5 w-5" /></button>
          {menu}
        </div>
      </div>
      <div className="px-4 pt-5">{body}</div>
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-3 border-t border-line bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        {askFirst ? (
          <>
            {link ? (
              <button type="button" onClick={() => void goToStore()} aria-label={t('offerDetail.openLink')} className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary" data-testid="offer-detail-store">
                <ExternalLink className="h-6 w-6" strokeWidth={1.8} />
              </button>
            ) : null}
            <button type="button" onClick={() => void message(`${t('offerDetail.aboutDraft', { title: offer.title })}\n`)} className="flex h-[52px] min-w-0 flex-1 items-center justify-center rounded-full bg-brand-primary px-4 text-body font-semibold text-white" data-testid="offer-detail-message">
              <span className="truncate">{t('offerDetail.askBrand', { brand: offer.brand_name })}</span>
            </button>
          </>
        ) : (
          <>
        <button
          type="button"
          onClick={() => void message(`${t('offerDetail.aboutDraft', { title: offer.title })}\n`)}
          aria-label={t('offerDetail.messageBrand', { brand: offer.brand_name })}
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary"
          data-testid="offer-detail-message"
        >
          <MessageCircle className="h-6 w-6" strokeWidth={1.8} />
        </button>
        {link ? (
          <button type="button" onClick={() => void goToStore()} className={cn('flex h-[52px] flex-1 items-center justify-center rounded-full bg-brand-primary text-body font-semibold text-white')} data-testid="offer-detail-store">
            {t('offerDetail.goToStore')}
          </button>
        ) : null}
          </>
        )}
      </div>
      {report.sheet}
    </div>
  )
}

/** The offer's code: one tap copies it; "Use it at checkout on <store>" (2026-11-07). */
function PromoCode({ code, onCopied }: { code: string; onCopied: () => void }) {
  const t = useBrandsT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      onCopied()
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="mt-5 flex items-center gap-3 rounded-[20px] border border-dashed border-brand-primary/40 bg-brand-soft/60 p-4" data-testid="offer-detail-code">
      <div className="min-w-0 flex-1">
        <p className="text-secondary text-ink-2">{t('offerDetail.yourCode')}</p>
        <p className="truncate font-mono text-title tracking-wide text-ink-1 select-all">{code}</p>
      </div>
      <button type="button" onClick={() => void copy()} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-row font-semibold text-brand-primary" data-testid="offer-detail-copy-code">
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        {copied ? t('offerDetail.copied') : t('offerDetail.copy')}
      </button>
    </div>
  )
}
