import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Header from '@/components/Header'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/lib/auth'
import { useMyBrand } from '@/hooks/useMyBrand'
import { useMyBrandOffers } from '@/hooks/useBrandOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { useToastStore } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { fetchBrandResults } from '@/lib/brandResults'
import {
  OFFER_OBJECTIVES,
  SMALL_AUDIENCE,
  audienceLine,
  isSmallAudience,
  brandCount,
  campaignCount,
  campaignHeadline,
  isFewer,
  isLinkOnly,
  campaignAudience,
  campaignRanDays,
  closingLine,
  daysLeftLine,
  offerErrorMessage,
  offerShownFields,
  shortDate,
  type BrandOffer,
} from '@/lib/brandOffers'
import { OfferPill, OfferThumb } from '@/components/brands/offers/OfferParts'
import { CampaignPreview } from '@/components/brands/offers/CampaignPreview'
import { useBrandsT } from '@/i18n/ns/brands'

const card = 'rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(15,15,20,0.06)]'
const eyebrow = 'text-caption font-semibold uppercase tracking-[0.06em] text-brand-primary'

/**
 * One campaign's report (founder 2026-11-21): what it is for, how long it has
 * left, the one number its objective is judged by, what members did, who
 * wrote, and a closing summary once it has ended. Counts are for the whole
 * life of the campaign, which is its window. Totals only; the only people
 * named are the ones who chose to write to the brand. No charts and no rates:
 * with few members a count is the honest unit, and under five the page says
 * so in words.
 */
export default function CampaignReportPage() {
  const t = useBrandsT()
  const navigate = useNavigate()
  const { offerId } = useParams()
  const role = useAuthStore((s) => s.profile?.role)
  const { brand } = useMyBrand()
  const { offers, isLoading, isError, refetch, duplicate } = useMyBrandOffers(role === 'brand')
  const names = useCountryNames()
  const addToast = useToastStore((s) => s.addToast)
  const [preview, setPreview] = useState(false)
  // The brand's inbox: conversations waiting for a reply, from any campaign or none.
  const results = useQuery({ queryKey: ['brand-results', 90], queryFn: () => fetchBrandResults(90), enabled: role === 'brand', staleTime: 60_000 })

  if (role && role !== 'brand') return <Navigate to="/dashboard/profile" replace />
  const offer = offers.find((o) => o.id === offerId) ?? null
  // An id that is not one of this brand's campaigns goes back to the list; a failed read says so instead.
  if (!isLoading && !isError && !offer) return <Navigate to="/dashboard/offers" replace />

  const runAgain = async (o: BrandOffer) => {
    try {
      const id = await duplicate.mutateAsync(o.id)
      navigate(`/dashboard/offers/${id}/edit`)
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
    }
  }

  return (
    <div className="min-h-screen bg-surface-subtle pt-[env(safe-area-inset-top)]" data-testid="campaign-report">
      <Header mobileHidden />
      <DetailNavBar parent={t('offersPage.title')} title={t('campaignReport.title')} fallbackPath="/dashboard/offers" />
      <main className="mx-auto max-w-[720px] space-y-3 px-4 pb-28 pt-3 lg:pt-under-header-lg">
        <h1 className="hidden font-display text-[40px] font-bold leading-[1.1] tracking-[-0.035em] text-ink-1 lg:block">{t('campaignReport.title')}</h1>
        {isError && !offer ? (
          <div className={card} data-testid="campaign-report-error">
            <p className="text-row text-ink-2">{t('campaignReport.error')}</p>
            <Button variant="tonal" className="mt-3 rounded-full" onClick={() => void refetch()}>{t('campaignReport.retry')}</Button>
          </div>
        ) : !offer ? <div className={cn(card, 'h-40 animate-pulse')} aria-busy="true" /> : (
          <Report
            offer={offer}
            countryNames={names(offerShownFields(offer).country_ids)}
            waiting={results.data?.waiting.count ?? 0}
            onMessages={() => navigate('/messages')}
            onResults={() => navigate('/dashboard/results')}
            onEdit={() => navigate(`/dashboard/offers/${offer.id}/edit`)}
            onPreview={() => setPreview(true)}
            onRunAgain={() => void runAgain(offer)}
            runningAgain={duplicate.isPending}
          />
        )}
      </main>

      <BottomSheet open={preview && Boolean(offer)} onClose={() => setPreview(false)} ariaLabel={t('campaignReport.seeAsMembers')}>
        {offer ? (
          <div className="px-5 pb-4">
            <h2 className="mb-3 text-title text-ink-1">{t('campaignReport.seeAsMembers')}</h2>
            <CampaignPreview fields={offerShownFields(offer)} brandName={brand?.name ?? t('offersPage.brandFallback')} countryNames={names(offerShownFields(offer).country_ids)} />
          </div>
        ) : null}
      </BottomSheet>
    </div>
  )
}

interface ReportProps {
  offer: BrandOffer
  countryNames: string[]
  /** Conversations waiting for the brand's reply in its inbox: from any campaign or none, not this campaign's own number. */
  waiting: number
  onMessages: () => void
  /** Who wrote is read per brand (Results), not per campaign. */
  onResults: () => void
  onEdit: () => void
  onPreview: () => void
  onRunAgain: () => void
  runningAgain: boolean
}

export function Report({ offer, countryNames, waiting, onMessages, onResults, onEdit, onPreview, onRunAgain, runningAgain }: ReportProps) {
  const t = useBrandsT()
  const shown = offerShownFields(offer)
  const objective = shown.objective ?? 'offer'
  const headline = campaignHeadline({ ...offer, objective })
  const ended = offer.status === 'ended'
  const started = offer.live_at !== null
  const ran = campaignRanDays(offer)
  const small = started && isSmallAudience(offer)
  const nobody = started && campaignAudience(offer) === 0
  const linkOnly = started && !small && isLinkOnly(offer)
  const talks = objective === 'ask' || objective === 'ambassador'
  const period = started
    ? [shortDate(offer.starts_at ?? offer.live_at ?? offer.created_at), offer.ended_at ?? offer.ends_at ? shortDate(offer.ended_at ?? (offer.ends_at as string)) : null].filter(Boolean).join(' – ')
    : null
  const rows: { key: string; label: string; n: number }[] = [
    { key: 'shown', label: t('campaignReport.rows.shown'), n: offer.shown },
    { key: 'opened', label: t('campaignReport.rows.opened'), n: offer.opened },
    ...(talks && !offer.store_visits ? [] : [{ key: 'store', label: t('campaignReport.rows.store'), n: offer.store_visits ?? 0 }]),
    ...((offer.code_copies ?? 0) > 0 || shown.promo_code ? [{ key: 'codes', label: t('campaignReport.rows.codes'), n: offer.code_copies ?? 0 }] : []),
    { key: 'contacted', label: objective === 'ambassador' ? t('campaignReport.rows.applied') : t('campaignReport.rows.contacted'), n: offer.contacted },
    { key: 'notUseful', label: t('campaignReport.rows.notUseful'), n: offer.not_useful },
  ]

  return (
    <>
      <section className={card} data-testid="campaign-report-header">
        <div className="flex items-start gap-3">
          <OfferThumb url={shown.image_url} className="h-14 w-14 shrink-0 rounded-[14px]" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-body font-semibold text-ink-1">{shown.title || t('offerParts.untitled')}</p>
            <p className="mt-0.5 text-row text-ink-2">{audienceLine(countryNames, shown.roles, { everywhere: shown.everywhere, regions: shown.regions }) || t('offerParts.noAudience')}</p>
          </div>
          <OfferPill offer={offer} />
        </div>
        <dl className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-row">
          <dt className="text-ink-2">{t('campaignReport.objective')}</dt>
          <dd className="text-ink-1" data-testid="campaign-report-objective">{OFFER_OBJECTIVES.find((o) => o.value === objective)?.label}</dd>
          {period ? (<><dt className="text-ink-2">{t('campaignReport.dates')}</dt><dd className="text-ink-1">{period}</dd></>) : null}
          {offer.status === 'live' && daysLeftLine(offer) ? (<><dt className="text-ink-2">{t('campaignReport.time')}</dt><dd className="text-ink-1" data-testid="campaign-report-left">{daysLeftLine(offer)}</dd></>) : null}
        </dl>
      </section>

      {!started ? (
        <section className={card} data-testid="campaign-report-not-started">
          <p className="text-row text-ink-2">{ended ? t('campaignReport.neverLive') : t('campaignReport.notStarted')}</p>
          {ended ? null : <Button className="mt-3 rounded-full" onClick={onEdit}>{t('campaignReport.edit')}</Button>}
        </section>
      ) : (
        <>
          <section className={card} data-testid="campaign-report-headline">
            <p className={eyebrow}>{t('campaignReport.headlineEyebrow')}</p>
            {small ? (
              <>
                <p className="mt-1 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink-1" data-testid="campaign-report-number">{t('campaignReport.fewer', { n: SMALL_AUDIENCE })}</p>
                <p className="mt-2 text-row text-ink-2" data-testid="campaign-report-small">{ended ? t('campaignReport.smallEnded', { n: SMALL_AUDIENCE }) : t('campaignReport.small', { n: SMALL_AUDIENCE })}</p>
              </>
            ) : (
              <>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className={cn('font-display font-bold leading-none tracking-[-0.03em] text-ink-1', isFewer(headline.n) ? 'text-[28px]' : 'text-[44px]')} data-testid="campaign-report-number">{campaignCount(headline.n)}</span>
                  <span className="text-body text-ink-2">{t(`campaignReport.headline.${headline.key}`, { count: isFewer(headline.n) ? SMALL_AUDIENCE : headline.n })}</span>
                </p>
                {nobody ? <p className="mt-2 text-row text-ink-2" data-testid="campaign-report-nobody">{ended ? t('campaignReport.nobodyEnded') : t('campaignReport.nobody')}</p> : null}
                {linkOnly ? <p className="mt-2 text-row text-ink-2" data-testid="campaign-report-link-only">{t('campaignReport.linkOnly')}</p> : null}
              </>
            )}
          </section>

          {small ? null : (
          <section className={card} data-testid="campaign-report-rows">
            <p className={eyebrow}>{t('campaignReport.didEyebrow')}</p>
            <ul className="mt-2 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-2.5" data-row={r.key}>
                  <span className="text-row text-ink-2">{r.label}</span>
                  <span className="text-body font-semibold text-ink-1">{campaignCount(r.n)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-ink-3">{t('campaignReport.rowsNote')}</p>
            {talks ? <button type="button" onClick={onResults} className="mt-1 flex min-h-[44px] items-center text-row font-semibold text-brand-primary" data-testid="campaign-report-who">{t('campaignReport.whoWrote')}</button> : null}
          </section>
          )}

          {ended ? (
            <section className={card} data-testid="campaign-report-closing">
              <p className={eyebrow}>{t('campaignReport.closingEyebrow')}</p>
              <p className="mt-1 text-body text-ink-1">{closingLine(offer, ran, headline)}</p>
              <Button className="mt-3 rounded-full" onClick={onRunAgain} loading={runningAgain} data-testid="campaign-report-run-again">{t('offersPage.actions.runAgain')}</Button>
            </section>
          ) : null}
        </>
      )}

      {waiting > 0 ? (
        <button type="button" onClick={onMessages} className="flex w-full items-center justify-between gap-3 rounded-[20px] bg-status-warning-soft p-4 text-left" data-testid="campaign-report-inbox">
          <span className="text-body font-semibold text-status-warning">{t('campaignReport.inbox', { count: waiting, n: brandCount(waiting) })}</span>
          <span className="shrink-0 text-row font-semibold text-status-warning">{t('campaignReport.reply')}</span>
        </button>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="tonal" className="rounded-full" onClick={onPreview} data-testid="campaign-report-preview">{t('campaignReport.seeAsMembers')}</Button>
        {offer.status === 'live' || offer.status === 'paused' ? <Button variant="tonal" className="rounded-full" onClick={onEdit}>{t('campaignReport.edit')}</Button> : null}
      </div>
    </>
  )
}
