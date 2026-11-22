import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { UserBubble } from '@/components/discover/UserBubble'
import { chipTone } from '@/components/ui/chipClasses'
import { fieldInput } from '@/components/ui/fieldClasses'
import { useMyBrand } from '@/hooks/useMyBrand'
import { MY_OFFERS } from '@/hooks/useBrandOffers'
import { useCountryNames } from '@/hooks/useCountryNames'
import { CAMPAIGN_DEFAULT_DAYS, OFFER_OBJECTIVES, audienceLine, saveOffer, type OfferObjective } from '@/lib/brandOffers'
import { needLabel, setOfferNeed } from '@/lib/marketplace'
import { CAMPAIGN_SENTENCE_MAX, draftAs, draftCampaign, draftToFields, keepDraft, keepSentence, keptDraft, keptSentence, type CampaignDraft, type DraftFailure } from '@/lib/campaignDraft'
import { useAuthStore } from '@/lib/auth'
import { useBrandsT } from '@/i18n/ns/brands'
import { useHockiaAiT } from '@/i18n/ns/hockiaAi'
import { MascotAvatar } from './mascot'

/** `original` is what the model returned; `draft` is that draft under the objective the brand chose. */
type Phase = { step: 'ask' } | { step: 'drafting' } | { step: 'draft'; original: CampaignDraft; draft: CampaignDraft } | { step: 'failed'; reason: DraftFailure }

function Turn({ children, thinking = false }: { children: React.ReactNode; thinking?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-2 border-[rgba(168,140,250,0.5)]">
        <MascotAvatar size={36} state={thinking ? 'thinking' : 'calm'} />
      </span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </div>
  )
}

/**
 * A campaign from one sentence, inside Hockia AI (founder 2026-11-21: chat to
 * ask and decide, cards to see and act). The brand says what it wants members
 * to do; Hockia AI returns a draft as a card; the brand can change the
 * objective with one tap and continues in the editor, where it adds the photo
 * and publishes. Nothing is published, and nothing is saved, until the brand
 * taps "Continue in the editor", which saves a draft only. The sentence and
 * the draft that came back for it are kept while the app is open, so closing
 * Hockia AI, even mid-request, loses neither.
 */
export function CampaignComposer({ onGo }: { onGo: (to: string) => void }) {
  const t = useHockiaAiT()
  const tb = useBrandsT()
  const { brand } = useMyBrand()
  const names = useCountryNames()
  const owner = useAuthStore((s) => s.user?.id ?? null)
  // Closing the sheet, even while the draft is being written, keeps the sentence.
  const qc = useQueryClient()
  const [text, setTextState] = useState(() => keptSentence(owner))
  const setText = (v: string) => { setTextState(v); keepSentence(owner, v) }
  const [phase, setPhase] = useState<Phase>(() => {
    const back = keptDraft(owner, keptSentence(owner))
    return back ? { step: 'draft', original: back.draft, draft: draftAs(back.draft, back.objective) } : { step: 'ask' }
  })
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const sentence = text.trim()

  const send = async () => {
    if (sentence.length < 3 || phase.step === 'drafting') return
    setPhase({ step: 'drafting' })
    try {
      const res = await draftCampaign(sentence)
      trackDbEvent('hockia_ai_campaign_draft', undefined, undefined, res.draft ? { result: 'draft', objective: res.draft.objective } : { result: res.reason })
      // Kept before it is shown: the sheet may have been closed while this was being written.
      keepDraft(owner, sentence, res.draft)
      setPhase(res.draft ? { step: 'draft', original: res.draft, draft: res.draft } : { step: 'failed', reason: res.reason })
    } catch (err) {
      logger.error('[CampaignComposer] draft failed', err)
      trackDbEvent('hockia_ai_campaign_draft', undefined, undefined, { result: 'unavailable' })
      setPhase({ step: 'failed', reason: 'unavailable' })
    }
  }

  const setObjective = (o: OfferObjective) => {
    if (phase.step !== 'draft') return
    keepDraft(owner, sentence, phase.original, o)
    setPhase({ step: 'draft', original: phase.original, draft: draftAs(phase.original, o) })
  }

  const startOver = () => { keepDraft(owner, sentence, null); setPhase({ step: 'ask' }) }

  const continueInEditor = async (draft: CampaignDraft) => {
    setSaving(true)
    setSaveFailed(false)
    try {
      const id = await saveOffer(null, draftToFields(draft, brand?.country_id), false)
      if (draft.need) {
        // The need is a detail the editor can set again: a failure here never loses the draft.
        try { await setOfferNeed(id, draft.need) } catch (err) { logger.error('[CampaignComposer] need not saved', err) }
      }
      trackDbEvent('hockia_ai_campaign_draft_continue', 'brand_offer', id, { objective: draft.objective })
      keepSentence(owner, '')
      keepDraft(owner, '', null)
      // The campaigns page opens a draft from its list: a list loaded before this save does not have it yet.
      try { await qc.refetchQueries({ queryKey: MY_OFFERS }) } catch (err) { logger.error('[CampaignComposer] list not refreshed', err) }
      onGo(`/dashboard/offers/${id}/edit`)
    } catch (err) {
      logger.error('[CampaignComposer] save failed', err)
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 lg:px-6" data-testid="hockia-ai-campaign-composer">
      <div className="flex flex-col gap-3 pt-1">
        <Turn>
          <p className="text-[16px] leading-[22px] text-ink-1">{t('composer.ask')}</p>
          <p className="mt-1 text-row text-ink-2">{t('composer.askNote')}</p>
        </Turn>

        {phase.step === 'ask' ? (
          <div data-testid="hockia-ai-campaign-ask">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, CAMPAIGN_SENTENCE_MAX))}
              rows={3}
              placeholder={t('composer.placeholder')}
              aria-label={t('composer.inputLabel')}
              className={cn(fieldInput, 'h-auto resize-none py-3')}
              data-testid="hockia-ai-campaign-input"
            />
            {text.length >= CAMPAIGN_SENTENCE_MAX ? <p className="mt-1.5 text-row text-ink-2" role="status" data-testid="hockia-ai-campaign-max">{t('composer.maxReached', { max: CAMPAIGN_SENTENCE_MAX })}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <button type="button" onClick={() => void send()} disabled={sentence.length < 3} className="inline-flex h-11 items-center whitespace-nowrap rounded-full bg-brand-primary px-5 text-body font-semibold text-white disabled:opacity-40" data-testid="hockia-ai-campaign-send">{t('composer.send')}</button>
              <button type="button" onClick={() => onGo('/dashboard/offers/new')} className="inline-flex h-11 items-center whitespace-nowrap px-2 text-body font-semibold text-ink-2">{t('composer.manual')}</button>
            </div>
          </div>
        ) : <UserBubble text={sentence} />}

        {phase.step === 'drafting' ? (
          <Turn thinking>
            <p className="flex items-center gap-2 text-row text-ink-2" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('composer.drafting')}</p>
          </Turn>
        ) : null}

        {phase.step === 'failed' ? (
          <Turn>
            <p className="text-[16px] leading-[22px] text-ink-1" data-testid="hockia-ai-campaign-failed">{phase.reason === 'limit' ? t('composer.limit') : t('composer.unavailable')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => onGo('/dashboard/offers/new')} className="inline-flex h-11 items-center rounded-full bg-brand-soft px-5 text-body font-semibold text-brand-primary" data-testid="hockia-ai-campaign-open-editor">{t('composer.openEditor')}</button>
              {phase.reason === 'unavailable' ? <button type="button" onClick={() => setPhase({ step: 'ask' })} className="inline-flex h-11 items-center px-2 text-body font-semibold text-ink-2">{t('composer.tryAgain')}</button> : null}
            </div>
          </Turn>
        ) : null}

        {phase.step === 'draft' ? (
          <Turn>
            <p className="text-[16px] leading-[22px] text-ink-1">{t('composer.ready')}</p>
            <div className="mt-3 rounded-[20px] border border-line bg-white p-3.5" data-testid="hockia-ai-campaign-draft">
              <p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{tb('offerParts.fromBrands')}</p>
              <p className="mt-1 text-body font-semibold text-ink-1" data-testid="hockia-ai-campaign-draft-title">{phase.draft.title || tb('offerParts.yourTitle')}</p>
              <p className="mt-1 text-row text-ink-2">{phase.draft.body || tb('offerParts.whatMembersGet')}</p>
              {phase.draft.perk ? <span className="mt-2 inline-block rounded-full bg-brand-soft px-2.5 py-0.5 text-caption font-semibold text-brand-primary" data-testid="hockia-ai-campaign-draft-perk">{phase.draft.perk}</span> : null}
              {phase.draft.promo_code ? <span className="ml-1.5 mt-2 inline-block rounded-full border border-line px-2.5 py-0.5 text-caption font-semibold text-ink-1" data-testid="hockia-ai-campaign-draft-code">{phase.draft.promo_code}</span> : null}
              <dl className="mt-3 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-secondary">
                <dt className="text-ink-2">{t('composer.forLabel')}</dt>
                <dd className="text-ink-1" data-testid="hockia-ai-campaign-draft-for">
                  {audienceLine(
                    phase.draft.place === 'my_country' && brand?.country_id != null ? names([brand.country_id]) : [],
                    phase.draft.roles,
                    { everywhere: !(phase.draft.place === 'my_country' && brand?.country_id != null) },
                  ) || tb('offerParts.noAudience')}
                </dd>
                {phase.draft.need ? (<><dt className="text-ink-2">{t('composer.needLabel')}</dt><dd className="text-ink-1">{needLabel(phase.draft.need)}</dd></>) : null}
                <dt className="text-ink-2">{t('composer.runsLabel')}</dt>
                <dd className="text-ink-1">{t('composer.runs', { days: CAMPAIGN_DEFAULT_DAYS })}</dd>
              </dl>
              <p className="mt-3 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t('composer.objectiveLabel')}</p>
              <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label={t('composer.objectiveLabel')}>
                {OFFER_OBJECTIVES.map((o) => {
                  const on = phase.draft.objective === o.value
                  return (
                    <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => setObjective(o.value)} className={cn('min-h-[44px] rounded-full px-3.5 py-1.5 text-left text-row font-semibold', chipTone(on))} data-testid={`hockia-ai-campaign-objective-${o.value}`}>
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="mt-2 text-row text-ink-2">{t('composer.next')}</p>
            {saveFailed ? <p className="mt-2 text-row text-status-danger" role="alert">{t('composer.saveFailed')}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void continueInEditor(phase.draft)} disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-primary px-5 text-body font-semibold text-white disabled:opacity-60" data-testid="hockia-ai-campaign-continue">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('composer.continue')}
              </button>
              <button type="button" onClick={startOver} disabled={saving} className="inline-flex h-11 items-center px-2 text-body font-semibold text-ink-2">{t('composer.rewrite')}</button>
            </div>
          </Turn>
        ) : null}
      </div>
    </div>
  )
}
