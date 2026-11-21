import { useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { shortDate, type OfferFields, type OfferRole } from '@/lib/brandOffers'
import { hockiaAiReasonLine, offerForLine } from '@/lib/memberOffers'
import type { Need } from '@/lib/marketplace'
import { useBrandsT } from '@/i18n/ns/brands'
import { OfferPreviewCard, OfferThumb } from './OfferParts'

type Place = 'home' | 'ai' | 'page'

/** The Hockia AI topic a campaign's need answers to (the topics a card can follow). */
const NEED_TOPIC: Record<Need, string> = {
  gear: 'gear',
  moving_abroad: 'moving abroad',
  training_recovery: 'training',
  for_clubs: 'kit',
}

interface CampaignPreviewProps {
  fields: OfferFields
  brandName: string
  need?: Need | null
  /** Names of the campaign's countries, for the "For" line and the reason. */
  countryNames?: string[]
  className?: string
}

/**
 * The campaign in the three places a member meets it (founder 2026-11-21):
 * the card on Home, the card under a Hockia AI answer, and the campaign page
 * with the button its objective gives. A phone frame, because that is where
 * members see it. Everything here is inert: it is a preview.
 */
export function CampaignPreview({ fields, brandName, need, countryNames = [], className }: CampaignPreviewProps) {
  const t = useBrandsT()
  const [place, setPlace] = useState<Place>('home')
  const title = fields.title?.trim() || t('offerParts.yourTitle')
  const body = fields.body?.trim() || t('offerParts.whatMembersGet')
  const perk = fields.objective === 'offer' ? fields.perk?.trim() : ''
  const code = fields.objective === 'offer' ? fields.promo_code?.trim() : ''
  const hasLink = Boolean(fields.link_url?.trim())
  const askFirst = fields.objective === 'ask' || (fields.objective !== 'ambassador' && !hasLink)
  const roles = (fields.roles ?? []) as OfferRole[]

  return (
    <div className={className} data-testid="campaign-preview">
      <SegmentedControl<Place>
        ariaLabel={t('campaignPreview.placesAria')}
        value={place}
        onChange={setPlace}
        options={[
          { value: 'home', label: t('campaignPreview.home') },
          { value: 'ai', label: t('campaignPreview.ai') },
          { value: 'page', label: t('campaignPreview.page') },
        ]}
      />
      <div className="mx-auto mt-3 w-full max-w-[320px] rounded-[32px] border-[6px] border-ink-1 bg-surface-subtle p-3" data-place={place}>
        {place === 'home' ? (
          <OfferPreviewCard fields={fields} brandName={brandName} reasonCountry={countryNames[0] ?? null} reasonRole={roles[0] ?? null} />
        ) : null}

        {place === 'ai' ? (
          <div data-testid="campaign-preview-ai">
            <div className="rounded-[18px] bg-white p-3 text-row text-ink-2">{t('campaignPreview.aiAnswer')}</div>
            <p className="mb-2 mt-3 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t('offerParts.fromBrands')}</p>
            <div className="rounded-[24px] border border-line bg-white p-3">
              <div className="flex items-start gap-3">
                <OfferThumb url={fields.image_url} className="h-16 w-16 shrink-0 rounded-[14px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-secondary font-semibold text-ink-2">{t('memberOfferCard.fromBrandsBy', { brand: brandName })}</span>
                  {perk ? <span className="mt-1 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-caption font-semibold text-brand-primary">{perk}</span> : null}
                  <span className="mt-0.5 block text-body font-semibold leading-[22px] text-ink-1 line-clamp-2">{title}</span>
                  <span className="mt-0.5 block truncate text-row text-ink-2">{body}</span>
                </span>
              </div>
              <p className="mt-3 flex gap-2 rounded-[14px] bg-surface-subtle p-3 text-secondary text-ink-2">
                <Info className="mt-px h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
                {hockiaAiReasonLine(NEED_TOPIC[need ?? 'gear'], null)}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="inline-flex h-9 items-center rounded-full bg-brand-soft px-4 text-row font-semibold text-brand-primary">{t('offerParts.seeOffer')}</span>
                <span className="text-row text-ink-2">{t('offerParts.notUseful')}</span>
              </div>
            </div>
          </div>
        ) : null}

        {place === 'page' ? (
          <div className="overflow-hidden rounded-[24px] bg-white" data-testid="campaign-preview-page">
            <OfferThumb url={fields.image_url} className="h-[120px] w-full" />
            <div className="p-4">
              <p className="text-secondary text-ink-2">{brandName}</p>
              {perk ? <span className="mt-2 inline-block rounded-full bg-brand-soft px-3 py-1 text-row font-semibold text-brand-primary">{perk}</span> : null}
              <p className="mt-2 text-title text-ink-1">{title}</p>
              <p className="mt-2 whitespace-pre-line text-row text-ink-2">{body}</p>
              {code ? (
                <div className="mt-3 rounded-[16px] border border-dashed border-brand-primary/40 bg-brand-soft/60 p-3">
                  <p className="text-secondary text-ink-2">{t('offerDetail.yourCode')}</p>
                  <p className="truncate font-mono text-body tracking-wide text-ink-1">{code}</p>
                </div>
              ) : null}
              <dl className="mt-3 grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-[16px] bg-surface-subtle p-3 text-secondary">
                <dt className="text-ink-2">{t('offerDetail.forLabel')}</dt>
                <dd className="text-ink-1">{roles.length ? offerForLine(roles, countryNames, { everywhere: fields.everywhere, regions: fields.regions }) : t('offerParts.noAudience')}</dd>
                {fields.ends_at ? (<><dt className="text-ink-2">{t('offerDetail.untilLabel')}</dt><dd className="text-ink-1">{shortDate(fields.ends_at)}</dd></>) : null}
              </dl>
              <div className="mt-4 space-y-2" data-testid="campaign-preview-actions">
                {fields.objective === 'ambassador' ? (
                  <PreviewButton primary>{t('offerDetail.ambassadorApply')}</PreviewButton>
                ) : askFirst ? (
                  <>
                    <PreviewButton primary>{t('offerDetail.askBrand', { brand: brandName })}</PreviewButton>
                    {hasLink ? <PreviewButton>{t('offerDetail.openLink')}</PreviewButton> : null}
                  </>
                ) : (
                  <>
                    <PreviewButton primary>{t('offerDetail.goToStore')}</PreviewButton>
                    <PreviewButton>{t('offerDetail.messageBrand', { brand: brandName })}</PreviewButton>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <p className="mx-auto mt-2 max-w-[320px] text-caption text-ink-3" data-testid="campaign-preview-note">
        {place === 'ai' ? t('campaignPreview.aiNote') : place === 'page' ? t('campaignPreview.pageNote') : t('campaignPreview.homeNote')}
      </p>
    </div>
  )
}

function PreviewButton({ primary = false, children }: { primary?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn('flex h-11 items-center justify-center rounded-full px-4 text-body font-semibold', primary ? 'bg-brand-primary text-white' : 'bg-brand-soft text-brand-primary')}>
      <span className="truncate">{children}</span>
    </span>
  )
}
