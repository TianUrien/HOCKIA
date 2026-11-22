import { supabase } from '@/lib/supabase'
import { EMPTY_OFFER, campaignEnd, type OfferFields, type OfferObjective, type OfferRole } from '@/lib/brandOffers'
import type { Need } from '@/lib/marketplace'

/**
 * "Write a campaign with Hockia AI" (founder 2026-11-21, step C). One sentence
 * from the brand becomes a draft through the campaign-draft edge function,
 * which checks every field against the editor's own vocabularies and limits.
 * The draft is never published from here: the brand continues in the editor,
 * where the photo, the link and the dates are set.
 */
export interface CampaignDraft {
  objective: OfferObjective
  title: string
  body: string
  need: Need | null
  roles: OfferRole[]
  place: 'everywhere' | 'my_country'
  perk: string | null
  promo_code?: string | null
}

export type DraftFailure = 'unavailable' | 'limit'
export type DraftResult = { draft: CampaignDraft } | { draft: null; reason: DraftFailure }

export const CAMPAIGN_SENTENCE_MAX = 500

/**
 * The sentence a brand was writing, kept while the app is open so closing
 * Hockia AI (even mid-request) never loses it. Held per member and in memory
 * only: it is gone on reload, and another account never sees it.
 */
let kept: { owner: string; text: string } | null = null
export const keptSentence = (owner: string | null | undefined): string => (owner && kept?.owner === owner ? kept.text : '')
export function keepSentence(owner: string | null | undefined, text: string): void {
  kept = owner && text.trim() ? { owner, text } : null
}

/**
 * The draft that came back for a sentence, kept the same way. A brand that
 * closes Hockia AI while the draft is being written finds it on return
 * instead of spending another of the day's drafts on the same sentence.
 */
let keptAnswer: { owner: string; sentence: string; draft: CampaignDraft; objective: OfferObjective } | null = null
export function keptDraft(owner: string | null | undefined, sentence: string): { draft: CampaignDraft; objective: OfferObjective } | null {
  return owner && keptAnswer?.owner === owner && keptAnswer.sentence === sentence.trim() ? { draft: keptAnswer.draft, objective: keptAnswer.objective } : null
}
export function keepDraft(owner: string | null | undefined, sentence: string, draft: CampaignDraft | null, objective: OfferObjective | null = null): void {
  keptAnswer = owner && draft ? { owner, sentence: sentence.trim(), draft, objective: objective ?? draft.objective } : null
}

/**
 * The draft as it reads under another objective. Always derived from the
 * draft the model returned, never from the last one shown, so choosing an
 * objective and coming back restores the perk, the code and who it is for.
 */
export function draftAs(original: CampaignDraft, objective: OfferObjective): CampaignDraft {
  const offer = objective === 'offer'
  return {
    ...original,
    objective,
    // Only players can be ambassadors.
    roles: objective === 'ambassador' ? ['player'] : original.roles,
    perk: offer ? original.perk : null,
    promo_code: offer ? original.promo_code ?? null : null,
  }
}

export async function draftCampaign(sentence: string): Promise<DraftResult> {
  // No locale: the draft is written in the language of the sentence, so a perk stays in the brand's own words.
  const { data, error } = await supabase.functions.invoke('campaign-draft', { body: { text: sentence } })
  if (error) throw error
  const res = data as { draft?: CampaignDraft | null; reason?: string } | null
  if (res?.draft) return { draft: res.draft }
  return { draft: null, reason: res?.reason === 'limit' ? 'limit' : 'unavailable' }
}

/**
 * The draft as the editor's fields. "My country" needs the brand's own
 * country; without one it reaches everyone, like a new campaign. The window
 * starts at the default 14 days so the editor has an end date to show.
 */
export function draftToFields(d: CampaignDraft, brandCountryId: number | null | undefined, now: Date = new Date()): OfferFields {
  const ownCountry = d.place === 'my_country' && brandCountryId != null
  return {
    ...EMPTY_OFFER,
    objective: d.objective,
    title: d.title,
    body: d.body,
    roles: d.roles,
    everywhere: !ownCountry,
    country_ids: ownCountry ? [brandCountryId] : [],
    perk: d.objective === 'offer' ? d.perk ?? '' : '',
    promo_code: d.objective === 'offer' ? d.promo_code ?? '' : '',
    ends_at: campaignEnd(now),
  }
}
