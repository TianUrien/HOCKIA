import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Header from '@/components/Header'
import Avatar from '@/components/Avatar'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/lib/auth'
import { useMyBrand } from '@/hooks/useMyBrand'
import { useMyBrandOffers } from '@/hooks/useBrandOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { useToastStore } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { fetchBrandResults, roleLabelOne } from '@/lib/brandResults'
import { fetchMyItemNeeds } from '@/lib/marketplace'
import {
  OFFER_OBJECTIVES,
  SMALL_AUDIENCE,
  audienceLine,
  brandCount,
  campaignHeadline,
  campaignRanDays,
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
  const { offers, isLoading, duplicate } = useMyBrandOffers(role === 'brand')
  const names = useCountryNames()
  const addToast = useToastStore((s) => s.addToast)
  const [preview, setPreview] = useState(false)
  // Who wrote and who is waiting come from the brand's results (90 days covers any campaign window).
  const results = useQuery({ queryKey: ['brand-results', 90], queryFn: () => fetchBrandResults(90), enabled: role === 'brand', staleTime: 60_000 })
  const needs = useQuery({ queryKey: ['my-brand-item-needs'], queryFn: fetchMyItemNeeds, enabled: role === 'brand', staleTime: 60_000 })

  if (role && role !== 'brand') return <Navigate to="/dashboard/profile" replace />
  const offer = offers.find((o) => o.id === offerId) ?? null
  if (!isLoading && !offer) return <Navigate to="/dashboard/offers" replace />

  const runAgain = async (o: BrandOffer) => {
    try {
      const id = await duplicate.mutateAsync(o.id)
      navigate(`/dashboard/offers/${id}/edit`)
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
    }
  }

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="campaign-report">
      <Header mobileHidden />
      <DetailNavBar parent={t('offersPage.title')} title={t('campaignReport.title')} fallbackPath="/dashboard/offers" />
      <main className="mx-auto max-w-[720px] space-y-3 px-4 pb-28 pt-3 lg:pt-under-header-lg">
        <h1 className="hidden font-display text-[40px] font-bold leading-[1.1] tracking-[-0.035em] text-ink-1 lg:block">{t('campaignReport.title')}</h1>
        {!offer ? <div className={cn(card, 'h-40 animate-pulse')} aria-busy="true" /> : (
          <Report
            offer={offer}
            countryNames={names(offerShownFields(offer).country_ids)}
            waiting={results.data?.waiting.count ?? 0}
            contacts={(results.data?.contacts ?? []).filter((c) => c.offer_title && c.offer_title === offer.title)}
            onMessages={() => navigate('/messages')}
            onOpenContact={(conversationId, profileId) => navigate(conversationId ? `/messages?conversation=${conversationId}` : `/messages?new=${profileId}`)}
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
            <CampaignPreview fields={offerShownFields(offer)} brandName={brand?.name ?? t('offersPage.brandFallback')} need={needs.data?.get(offer.id) ?? null} countryNames={names(offerShownFields(offer).country_ids)} />
          </div>
        ) : null}
      </BottomSheet>
    </div>
  )
}

interface ReportProps {
  offer: BrandOffer
  countryNames: string[]
  /** Conversations waiting for the brand's reply, across its campaigns. */
  waiting: number
  contacts: { profile_id: string; full_name: string | null; avatar_url: string | null; role: string; conversation_id: string | null }[]
  onMessages: () => void
  onOpenContact: (conversationId: string | null, profileId: string) => void
  onEdit: () => void
  onPreview: () => void
  onRunAgain: () => void
  runningAgain: boolean
}

export function Report({ offer, countryNames, waiting, contacts, onMessages, onOpenContact, onEdit, onPreview, onRunAgain, runningAgain }: ReportProps) {
  const t = useBrandsT()
  const shown = offerShownFields(offer)
  const objective = shown.objective ?? 'offer'
  const headline = campaignHeadline({ ...offer, objective })
  const ended = offer.status === 'ended'
  const started = offer.live_at !== null
  const ran = campaignRanDays(offer)
  const small = started && offer.shown < SMALL_AUDIENCE
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
          <p className="text-row text-ink-2">{t('campaignReport.notStarted')}</p>
          <Button className="mt-3 rounded-full" onClick={onEdit}>{t('campaignReport.edit')}</Button>
        </section>
      ) : (
        <>
          {talks && waiting > 0 ? (
            <button type="button" onClick={onMessages} className="flex w-full items-center justify-between gap-3 rounded-[20px] bg-status-warning-soft p-4 text-left" data-testid="campaign-report-waiting">
              <span className="text-body font-semibold text-status-warning">{t('campaignReport.waiting', { count: waiting, n: brandCount(waiting) })}</span>
              <span className="shrink-0 text-row font-semibold text-status-warning">{t('campaignReport.reply')}</span>
            </button>
          ) : null}

          <section className={card} data-testid="campaign-report-headline">
            <p className={eyebrow}>{t('campaignReport.headlineEyebrow')}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-[44px] font-bold leading-none tracking-[-0.03em] text-ink-1" data-testid="campaign-report-number">{brandCount(headline.n)}</span>
              <span className="text-body text-ink-2">{t(`campaignReport.headline.${headline.key}`, { count: headline.n })}</span>
            </p>
            {small ? <p className="mt-3 rounded-[14px] bg-surface-subtle p-3 text-row text-ink-2" data-testid="campaign-report-small">{t('campaignReport.small', { n: SMALL_AUDIENCE })}</p> : null}
          </section>

          <section className={card} data-testid="campaign-report-rows">
            <p className={eyebrow}>{t('campaignReport.didEyebrow')}</p>
            <ul className="mt-2 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-2.5" data-row={r.key}>
                  <span className="text-row text-ink-2">{r.label}</span>
                  <span className="text-body font-semibold text-ink-1">{brandCount(r.n)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-ink-3">{t('campaignReport.rowsNote')}</p>
          </section>

          {contacts.length > 0 ? (
            <section className={card} data-testid="campaign-report-contacts">
              <p className={eyebrow}>{t('campaignReport.contactsEyebrow')}</p>
              <ul className="mt-2 divide-y divide-line">
                {contacts.map((c) => (
                  <li key={c.profile_id} className="flex items-center gap-3 py-2.5">
                    <Avatar src={c.avatar_url} alt={c.full_name ?? ''} role={c.role} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-semibold text-ink-1">{c.full_name ?? t('campaignReport.member')}</span>
                      <span className="block text-row text-ink-2">{roleLabelOne(c.role)}</span>
                    </span>
                    <button type="button" onClick={() => onOpenContact(c.conversation_id, c.profile_id)} className="flex h-11 shrink-0 items-center px-1 text-row font-semibold text-brand-primary">{t('campaignReport.message')}</button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {ended ? (
            <section className={card} data-testid="campaign-report-closing">
              <p className={eyebrow}>{t('campaignReport.closingEyebrow')}</p>
              <p className="mt-1 text-body text-ink-1">
                {t('campaignReport.closing', { days: ran ?? 0, shown: brandCount(offer.shown), opened: brandCount(offer.opened) })}{' '}
                {t(`campaignReport.closingHeadline.${headline.key}`, { count: headline.n, n: brandCount(headline.n) })}
              </p>
              <Button className="mt-3 rounded-full" onClick={onRunAgain} loading={runningAgain} data-testid="campaign-report-run-again">{t('offersPage.actions.runAgain')}</Button>
            </section>
          ) : null}
        </>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="tonal" className="rounded-full" onClick={onPreview} data-testid="campaign-report-preview">{t('campaignReport.seeAsMembers')}</Button>
        {offer.status === 'live' || offer.status === 'paused' ? <Button variant="tonal" className="rounded-full" onClick={onEdit}>{t('campaignReport.edit')}</Button> : null}
      </div>
    </>
  )
}
