import { supabase } from '@/lib/supabase'
import { tBrands } from '@/i18n/ns/brands'
import { formatNumber, intlLocale, isEnglish } from '@/i18n/format'
import { lazyTextRecord, withLazyText } from '@/lib/opportunityLazyText'

/**
 * Brand offers, Phase 1 (founder 2026-10-23; Figma page "08 · Brands (all
 * phases)", section P1; migration 20261023160000).
 *
 * An offer reaches members by WHERE THEY LIVE and their role, never by
 * nationality. An offer goes live as soon as the brand publishes it (founder
 * 2026-10-25: no approval step); an admin can take it down after, with a
 * reason the brand sees. Up to
 * 5 live offers per brand while free (drafts and paused offers don't count).
 * An edit of a live / paused offer applies at once.
 */

export type OfferStatus = 'draft' | 'in_review' | 'not_approved' | 'live' | 'paused' | 'ended'
export type OfferRole = 'player' | 'coach' | 'club' | 'umpire'
export type OfferAction = 'pause' | 'resume' | 'end' | 'delete'

/**
 * What the brand wants members to do (founder 2026-11-21, proposal
 * docs/product/proposals/brand-promotion.md). It sets the member's button,
 * the fields the editor asks for and the number that counts.
 */
export type OfferObjective = 'ask' | 'product' | 'offer' | 'ambassador'
export const OFFER_OBJECTIVES: { value: OfferObjective; readonly label: string; readonly hint: string }[] = [
  withLazyText({ value: 'ask' as OfferObjective }, { label: () => tBrands('offers.objectives.ask.label'), hint: () => tBrands('offers.objectives.ask.hint') }),
  withLazyText({ value: 'product' as OfferObjective }, { label: () => tBrands('offers.objectives.product.label'), hint: () => tBrands('offers.objectives.product.hint') }),
  withLazyText({ value: 'offer' as OfferObjective }, { label: () => tBrands('offers.objectives.offer.label'), hint: () => tBrands('offers.objectives.offer.hint') }),
  withLazyText({ value: 'ambassador' as OfferObjective }, { label: () => tBrands('offers.objectives.ambassador.label'), hint: () => tBrands('offers.objectives.ambassador.hint') }),
]
/** A campaign that asks members to write or to apply needs no store link. */
export const linkOptional = (o: OfferObjective | null | undefined) => o === 'ask' || o === 'ambassador'

/** A campaign runs 7 to 15 days and stops by itself (founder 2026-11-21). */
export const CAMPAIGN_MIN_DAYS = 7
export const CAMPAIGN_MAX_DAYS = 15
export const CAMPAIGN_DEFAULT_DAYS = 14
const DAY_MS = 86_400_000
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
/** The day a campaign's window is counted from: its start date, else when it went live, else today. */
export function campaignStart(f: Pick<OfferFields, 'starts_at'>, liveAt?: string | null, now: Date = new Date()): Date {
  return new Date(f.starts_at ?? liveAt ?? now)
}
/** The end of the day `days` after the start, as the date field stores it. */
export function campaignEnd(start: Date, days: number = CAMPAIGN_DEFAULT_DAYS): string {
  return `${new Date(dayStart(start) + days * DAY_MS).toISOString().slice(0, 10)}T23:59:59Z`
}
/** Whole days from the start day to the end day, or null with no end. */
export function campaignDays(f: Pick<OfferFields, 'starts_at' | 'ends_at'>, liveAt?: string | null, now: Date = new Date()): number | null {
  if (!f.ends_at) return null
  return Math.round((dayStart(new Date(f.ends_at)) - dayStart(campaignStart(f, liveAt, now))) / DAY_MS)
}

export const OFFER_LIVE_LIMIT = 5
export const OFFER_TITLE_MAX = 60
export const OFFER_BODY_MAX = 140
/** `label` is read in the interface language on every access. */
// Literal calls (not .map) so the bundler can drop this table from the start-up chunk.
export const OFFER_ROLES: { value: OfferRole; readonly label: string }[] = [
  withLazyText({ value: 'player' as OfferRole }, { label: () => tBrands('offers.roles.player') }),
  withLazyText({ value: 'coach' as OfferRole }, { label: () => tBrands('offers.roles.coach') }),
  withLazyText({ value: 'club' as OfferRole }, { label: () => tBrands('offers.roles.club') }),
  withLazyText({ value: 'umpire' as OfferRole }, { label: () => tBrands('offers.roles.umpire') }),
]

/** A count as the interface language writes it (English keeps plain digits, as before). */
export function brandCount(n: number): string {
  return isEnglish() ? String(n) : formatNumber(n)
}

export interface OfferFields {
  title: string | null
  body: string | null
  image_url: string | null
  link_url: string | null
  country_ids: number[]
  area: string | null
  roles: OfferRole[]
  starts_at: string | null
  ends_at: string | null
  /** Every eligible member, with or without a country (2026-11-07). */
  everywhere?: boolean
  /** Whole regions (countries.region): members based anywhere in them. */
  regions?: string[]
  /** "15% off": what members get, at a glance (24 max; 2026-11-07). */
  perk?: string | null
  /** A code members copy on the offer page, so the brand counts sales (2026-11-07). */
  promo_code?: string | null
  /** What the brand wants members to do; absent from servers before 2026-11-21 (then an offer). */
  objective?: OfferObjective | null
}

export const OFFER_PERK_MAX = 24
export const PROMO_CODE_RE = /^[A-Za-z0-9_-]{2,30}$/

/** The regions a brand can pick (countries.region values), largest hockey markets first. */
export const OFFER_REGIONS: string[] = ['Europe', 'South America', 'Oceania', 'Asia', 'Africa', 'North America', 'Central America', 'Caribbean']

const REGION_KEYS: Record<string, 'europe' | 'southAmerica' | 'oceania' | 'asia' | 'africa' | 'northAmerica' | 'centralAmerica' | 'caribbean'> = {
  Europe: 'europe', 'South America': 'southAmerica', Oceania: 'oceania', Asia: 'asia', Africa: 'africa',
  'North America': 'northAmerica', 'Central America': 'centralAmerica', Caribbean: 'caribbean',
}
/** A region value (countries.region, stored in English) as shown in the interface. */
export function offerRegionLabel(region: string): string {
  const key = REGION_KEYS[region]
  return key ? tBrands(`offers.regions.${key}`) : region
}

export interface BrandOffer extends OfferFields {
  id: string
  status: OfferStatus
  pending: Partial<OfferFields> | null
  pending_status: 'in_review' | 'not_approved' | null
  review_note: string | null
  submitted_at: string | null
  live_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
  shown: number
  opened: number
  contacted: number
  not_useful: number
  /** Members who went to the store from the offer (Go to store). */
  store_visits: number
  /** Members who copied the offer's code. */
  code_copies?: number
}

export interface AdminBrandOffer extends OfferFields {
  id: string
  brand_id: string
  brand_name: string
  brand_logo_url: string | null
  brand_profile_id: string
  status: OfferStatus
  pending: Partial<OfferFields> | null
  pending_status: 'in_review' | 'not_approved' | null
  review_note: string | null
  submitted_at: string | null
  live_at: string | null
  brand_live_count: number
  brand_offer_count: number
}

/** Admin tabs: live offers, and the ones taken down. */
export type AdminOfferTab = 'live' | 'not_approved'

// ── Grouping and status words (B1-all) ─────────────────────────────────────

export type OfferGroup = 'needs_you' | 'live' | 'waiting' | 'paused_ended'

/** Which section of the brand's list an offer sits in (Figma B1-all). "Needs
 *  you" holds offers an admin took down; drafts sit under "Drafts". */
export function offerGroup(o: Pick<BrandOffer, 'status' | 'pending_status'>): OfferGroup {
  if (o.status === 'not_approved' || o.pending_status === 'not_approved') return 'needs_you'
  if (o.status === 'in_review' || o.status === 'draft') return 'waiting'
  if (o.status === 'live') return 'live'
  return 'paused_ended'
}

export const OFFER_GROUP_LABELS: Record<OfferGroup, string> = lazyTextRecord({
  needs_you: () => tBrands('offers.groups.needsYou'),
  live: () => tBrands('offers.groups.live'),
  waiting: () => tBrands('offers.groups.drafts'),
  paused_ended: () => tBrands('offers.groups.pausedEnded'),
})

export type OfferPillTone = 'positive' | 'neutral' | 'amber' | 'muted'

/** The state pill: green only for Live, amber only where the brand must act. */
export function offerPill(o: Pick<BrandOffer, 'status' | 'pending_status'>): { label: string; tone: OfferPillTone } {
  if (o.status === 'not_approved') return { label: tBrands('offers.pill.takenDown'), tone: 'amber' }
  switch (o.status) {
    case 'live': return { label: tBrands('offers.pill.live'), tone: 'positive' }
    case 'in_review': return { label: tBrands('offers.pill.draft'), tone: 'neutral' }
    case 'draft': return { label: tBrands('offers.pill.draft'), tone: 'neutral' }
    case 'paused': return { label: tBrands('offers.pill.paused'), tone: 'muted' }
    default: return { label: tBrands('offers.pill.ended'), tone: 'muted' }
  }
}

export function liveCount(offers: Pick<BrandOffer, 'status'>[]): number {
  return offers.filter((o) => o.status === 'live').length
}

export function liveLimitLine(offers: Pick<BrandOffer, 'status'>[]): string {
  return tBrands('offers.liveLimitLine', { live: brandCount(liveCount(offers)), limit: OFFER_LIVE_LIMIT })
}

/** "158 shown · 31 opened · 12 went to your store · 5 contacted" (+ "· 2 not useful" when any). */
export function offerCountsLine(o: Pick<BrandOffer, 'shown' | 'opened' | 'contacted'> & Partial<Pick<BrandOffer, 'store_visits' | 'not_useful' | 'code_copies' | 'objective'>>): string {
  // Under five members, exact counts would say what one person did (founder 2026-11-21).
  if (isSmallAudience(o)) return tBrands('offers.counts.fewer', { n: SMALL_AUDIENCE })
  return [
    countPart('shown', o.shown),
    countPart('opened', o.opened),
    // A campaign that asks members to write or to apply has no store to go to.
    linkOptional(o.objective) && !(o.store_visits ?? 0) ? null : countPart('storeVisits', o.store_visits ?? 0),
    (o.code_copies ?? 0) > 0 ? countPart('codeCopies', o.code_copies ?? 0) : null,
    countPart('contacted', o.contacted),
    (o.not_useful ?? 0) > 0 ? countPart('notUseful', o.not_useful ?? 0) : null,
  ].filter(Boolean).join(', ')
}

function countPart(key: 'shown' | 'opened' | 'storeVisits' | 'codeCopies' | 'contacted' | 'notUseful', n: number): string {
  // "fewer than 5 opened": the masked form takes the plural.
  return tBrands(`offers.counts.${key}`, { count: isFewer(n) ? SMALL_AUDIENCE : n, n: countInLine(n) })
}

/** "3 days left" on a live campaign with an end date; "Ends today" on its last day. */
export function daysLeftLine(o: Pick<BrandOffer, 'ends_at'>, now: Date = new Date()): string | null {
  if (!o.ends_at) return null
  // In the reader's own calendar days: counted in UTC, a brand west of UTC
  // would read "Ends today" a day early.
  const localDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const left = Math.round((localDay(new Date(o.ends_at)) - localDay(now)) / DAY_MS)
  if (left < 0) return null
  return left === 0 ? tBrands('offers.daysLeft.today') : tBrands('offers.daysLeft.days', { count: left })
}

// ── The campaign report (2026-11-21) ────────────────────────────────────────

/**
 * Under this many members a campaign's counts are not shown: with one or two
 * people, an exact "opened 1, not useful 1" says what a person did. The same
 * threshold as the breakdowns (founder 2026-10-23), applied to every
 * per-campaign total (founder 2026-11-21). Nobody at all is a plain zero.
 */
export const SMALL_AUDIENCE = 5
export function isSmallAudience(o: Pick<BrandOffer, 'shown'>): boolean {
  return o.shown > 0 && o.shown < SMALL_AUDIENCE
}
/** A per-campaign total the brand may not read exactly: one to four members. */
export const isFewer = (n: number) => n > 0 && n < SMALL_AUDIENCE
/**
 * A per-campaign total as the brand reads it (founder 2026-11-21): one to four
 * reads "Fewer than 5", like the breakdowns; zero and five or more are
 * numbers. A zero is only printed beside an audience of five or more (see
 * isSmallAudience), where it cannot be traced to a person.
 */
export function campaignCount(n: number): string {
  return isFewer(n) ? tBrands('campaignReport.fewer', { n: SMALL_AUDIENCE }) : brandCount(n)
}
/** The same inside a sentence: "fewer than 5". */
const countInLine = (n: number) => (isFewer(n) ? tBrands('offers.counts.fewerN', { n: SMALL_AUDIENCE }) : brandCount(n))

export type CampaignHeadline = 'asked' | 'applied' | 'store'
/**
 * The one number a campaign is judged by, from its objective: members who
 * wrote (a question), players who applied (ambassadors), or members who went
 * to the store (a product or an offer).
 */
export function campaignHeadline(o: Pick<BrandOffer, 'contacted' | 'store_visits'> & { objective?: OfferObjective | null }): { key: CampaignHeadline; n: number } {
  if (o.objective === 'ask') return { key: 'asked', n: o.contacted }
  if (o.objective === 'ambassador') return { key: 'applied', n: o.contacted }
  return { key: 'store', n: o.store_visits ?? 0 }
}

/** Whole days the campaign has run or ran, from the day it went live. 0 means less than a day. */
export function campaignRanDays(o: Pick<BrandOffer, 'live_at' | 'starts_at' | 'ended_at' | 'ends_at' | 'status'>, now: Date = new Date()): number | null {
  const from = o.starts_at ?? o.live_at
  if (!from) return null
  const to = o.status === 'ended' ? o.ended_at ?? o.ends_at ?? now.toISOString() : now.toISOString()
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS))
}

/**
 * "It ran 14 days. It was shown to 84 members and 19 opened it. 6 wrote to
 * you." Every part has its own singular; under a day it says so; under five
 * members it gives no counts.
 */
export function closingLine(offer: Pick<BrandOffer, 'shown' | 'opened'>, ranDays: number | null, headline: { key: CampaignHeadline; n: number }): string {
  const ran = ranDays === null ? null : ranDays < 1 ? tBrands('campaignReport.closingRanUnderDay') : tBrands('campaignReport.closingRan', { count: ranDays })
  if (offer.shown === 0) return [ran, tBrands('campaignReport.nobody')].filter(Boolean).join(' ')
  if (isSmallAudience(offer)) return [ran, tBrands('campaignReport.small', { n: SMALL_AUDIENCE })].filter(Boolean).join(' ')
  return [
    ran,
    tBrands('campaignReport.closingShown', { count: offer.shown, n: brandCount(offer.shown) }),
    tBrands('campaignReport.closingOpened', { count: isFewer(offer.opened) ? SMALL_AUDIENCE : offer.opened, n: countInLine(offer.opened) }),
    isFewer(headline.n)
      ? tBrands(`campaignReport.closingHeadlineFewer.${headline.key}`, { n: SMALL_AUDIENCE })
      : tBrands(`campaignReport.closingHeadline.${headline.key}`, { count: headline.n, n: brandCount(headline.n) }),
  ].filter(Boolean).join(' ')
}

/** "today" / "yesterday" / "3 days ago" (B1 status lines). */
export function daysAgoWord(iso: string | null, now: Date = new Date()): string {
  if (!iso) return tBrands('offers.daysAgo.recently')
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(now) - start(new Date(iso))) / 86_400_000)
  if (days <= 0) return tBrands('offers.daysAgo.today')
  if (days === 1) return tBrands('offers.daysAgo.yesterday')
  return tBrands('offers.daysAgo.days', { count: days })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "30 Sep" (fixed words: some ICU versions write "Sept"). */
export const shortDate = (iso: string) => {
  const d = new Date(iso)
  if (isEnglish()) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace(/\./g, '')
}

/** The line beside the pill on a list row (Figma B1-all). */
export function offerStatusLine(o: BrandOffer, now: Date = new Date()): string {
  const note = (o.review_note ?? '').trim().replace(/[.!]+$/, '')
  // Taken down by an admin: the reason word for word, and the way back.
  if (o.status === 'not_approved') return note ? tBrands('offers.status.takenDownNote', { note }) : tBrands('offers.status.takenDown')
  switch (o.status) {
    case 'live': return [offerCountsLine(o), daysLeftLine(o, now)].filter(Boolean).join('. ')
    case 'in_review':
    case 'draft': return tBrands('offers.status.notPublished')
    case 'paused': return tBrands('offers.status.paused', { when: daysAgoWord(o.updated_at, now) })
    default: return tBrands('offers.status.ended', {
      date: shortDate(o.ended_at ?? o.updated_at),
      counts: isSmallAudience(o)
        ? tBrands('offers.counts.fewer', { n: SMALL_AUDIENCE })
        : [countPart('shown', o.shown), linkOptional(o.objective) && !(o.store_visits ?? 0) ? null : countPart('storeVisits', o.store_visits ?? 0), countPart('contacted', o.contacted)].filter(Boolean).join(', '),
    })
  }
}

/** The offer as members will see it: a pending change wins over the live copy. */
export function offerShownFields(o: BrandOffer): OfferFields {
  return { ...pickFields(o), ...(o.pending ?? {}) } as OfferFields
}

function pickFields(o: OfferFields): OfferFields {
  return {
    title: o.title, body: o.body, image_url: o.image_url, link_url: o.link_url,
    country_ids: o.country_ids ?? [], area: o.area, roles: o.roles ?? [], starts_at: o.starts_at, ends_at: o.ends_at,
    everywhere: o.everywhere ?? false, regions: o.regions ?? [], perk: o.perk ?? null, promo_code: o.promo_code ?? null,
    objective: o.objective ?? 'offer',
  }
}

export const EMPTY_OFFER: OfferFields = {
  title: '', body: '', image_url: null, link_url: '', country_ids: [], area: '', roles: [], starts_at: null, ends_at: null, everywhere: false, regions: [], perk: '', promo_code: '',
  // A new campaign starts with no objective: the editor asks first.
  objective: null,
}

// ── Content rules (B2) ──────────────────────────────────────────────────────

/** "northlinehockey.com/hockia" → "https://northlinehockey.com/hockia"; null when not a usable https address. */
export function normalizeOfferLink(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!t || /\s/.test(t)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname)) return null
    return u.href.length <= 500 ? u.href : null
  } catch {
    return null
  }
}

/** Words the brand can't claim without proof (B2 helper; members can report the rest). */
const UNPROVABLE = /\b(best|cheapest|lowest price|number one|no\.? ?1|guaranteed)\b/i
export function unprovableClaim(text: string | null | undefined): string | null {
  const m = (text ?? '').match(UNPROVABLE)
  return m ? m[0] : null
}

/** What still blocks "Publish", in the editor's order, or null. */
export function offerMissing(f: OfferFields, liveAt?: string | null): string | null {
  if (!f.objective) return tBrands('offers.missing.objective')
  // A real photo makes offers look trustworthy; required to publish (2026-11-07, client-side so old apps keep working).
  if (!f.image_url) return tBrands('offers.missing.photo')
  if (!f.title?.trim()) return tBrands('offers.missing.title')
  if (f.title.trim().length > OFFER_TITLE_MAX) return tBrands('offers.missing.titleTooLong', { max: OFFER_TITLE_MAX })
  if (!f.body?.trim()) return tBrands('offers.missing.body')
  if (f.body.trim().length > OFFER_BODY_MAX) return tBrands('offers.missing.bodyTooLong', { max: OFFER_BODY_MAX })
  if ((f.perk ?? '').trim().length > OFFER_PERK_MAX) return tBrands('offers.missing.perkTooLong', { max: OFFER_PERK_MAX })
  if ((f.promo_code ?? '').trim() && !PROMO_CODE_RE.test((f.promo_code ?? '').trim())) return tBrands('offers.missing.promoCode')
  if ((f.link_url ?? '').trim() || !linkOptional(f.objective)) {
    if (!normalizeOfferLink(f.link_url)) return tBrands('offers.missing.link')
  }
  if (!f.everywhere && f.country_ids.length === 0 && (f.regions ?? []).length === 0) return tBrands('offers.missing.where')
  if (f.roles.length === 0) return tBrands('offers.missing.who')
  if (!f.ends_at) return tBrands('offers.missing.endRequired')
  if (new Date(f.ends_at).getTime() <= Date.now()) return tBrands('offers.missing.endDate')
  const days = campaignDays(f, liveAt)
  if (days != null && (days < CAMPAIGN_MIN_DAYS || days > CAMPAIGN_MAX_DAYS)) return tBrands('offers.missing.window', { min: CAMPAIGN_MIN_DAYS, max: CAMPAIGN_MAX_DAYS })
  return null
}

// ── The reason line (shown with every offer) ────────────────────────────────

const OFFER_ROLE_SET = new Set<string>(['player', 'coach', 'club', 'umpire'])

/**
 * "You see this because you live in England and play." Location and role
 * only, never nationality; no goal until goals are stored (founder 2026-10-23).
 */
// Country names that take "the" inside a sentence ("you live in the United
// Kingdom"); labels and chips keep the bare name (design review 2026-10-25).
const TAKES_THE = new Set([
  'united kingdom', 'netherlands', 'united states', 'united states of america', 'united arab emirates',
  'czech republic', 'dominican republic', 'central african republic', 'philippines', 'bahamas', 'gambia',
  'maldives', 'comoros', 'seychelles', 'solomon islands', 'marshall islands', 'cayman islands',
  'democratic republic of the congo', 'republic of the congo', 'vatican city',
])
/** A country name as it reads in a sentence: "the United Kingdom", "England". */
export function countryInSentence(name: string): string {
  return TAKES_THE.has(name.trim().toLowerCase()) ? `the ${name.trim()}` : name.trim()
}

export function offerReasonLine(countryName: string | null, role: string | null | undefined, everywhere = false): string {
  const r = role && OFFER_ROLE_SET.has(role) ? (role as OfferRole) : null
  // An Everywhere offer is about the role only, never where the member lives.
  if (everywhere) return r ? tBrands(`offers.reasonEverywhere.${r}`) : tBrands('offers.reason.everywhere')
  // "the United Kingdom" is English grammar; other languages take the bare name.
  const where = countryName ? (isEnglish() ? countryInSentence(countryName) : countryName.trim()) : null
  if (where && r) return tBrands(`offers.reasonWhere.${r}`, { where })
  if (where) return tBrands('offers.reason.where', { where })
  return tBrands('offers.reason.fallback')
}

/** "England, Netherlands · Players, coaches" for list rows ("Everywhere · …", regions first). */
export function audienceLine(countryNames: string[], roles: OfferRole[], place?: { everywhere?: boolean; regions?: string[] }): string {
  const who = roles.map((r) => OFFER_ROLES.find((x) => x.value === r)?.label ?? r)
  const whoText = who.length ? who[0] + (who.length > 1 ? ', ' + who.slice(1).map((w) => w.toLowerCase()).join(', ') : '') : ''
  const where = place?.everywhere ? tBrands('offers.everywhere') : [...(place?.regions ?? []).map(offerRegionLabel), ...countryNames].join(', ')
  return [where, whoText].filter(Boolean).join('. ')
}

/** The editor's reach line from get_brand_offer_reach (counts under 5 come back as null). */
export interface OfferReach { total: number | null; without_country: number | null; by_role: Record<string, number | null>; by_country: { country_id: number; n: number | null }[] }
export function reachLine(r: OfferReach | null, roles: OfferRole[]): string | null {
  if (!r) return null
  if (r.total == null) return tBrands('offers.reach.fewer')
  const parts = OFFER_ROLES.filter((x) => roles.includes(x.value))
    .map((x) => { const n = r.by_role[x.value]; return n == null ? null : tBrands(`offers.reachRole.${x.value}`, { count: n, n: brandCount(n) }) })
    .filter(Boolean)
  return parts.length > 1
    ? tBrands('offers.reach.totalWithRoles', { count: r.total, n: brandCount(r.total), roles: parts.join(', ') })
    : tBrands('offers.reach.total', { count: r.total, n: brandCount(r.total) })
}

export async function fetchOfferReach(f: Pick<OfferFields, 'everywhere' | 'regions' | 'country_ids' | 'roles' | 'area'>): Promise<OfferReach | null> {
  const { data, error } = await supabase.rpc('get_brand_offer_reach', {
    p_everywhere: f.everywhere ?? false,
    p_country_ids: f.country_ids,
    p_regions: f.regions ?? [],
    p_roles: f.roles,
    p_area: (f.area ?? '').trim() || undefined,
  })
  if (error) throw error
  return (data ?? null) as unknown as OfferReach | null
}

// ── Server calls ────────────────────────────────────────────────────────────

export async function fetchMyOffers(): Promise<BrandOffer[]> {
  const { data, error } = await supabase.rpc('get_my_brand_offers')
  if (error) throw error
  return (data ?? []) as unknown as BrandOffer[]
}

export async function saveOffer(offerId: string | null, f: OfferFields, submit: boolean): Promise<string> {
  const args = {
    p_offer_id: offerId as string,
    p_title: (f.title ?? '').trim(),
    p_body: (f.body ?? '').trim(),
    p_image_url: f.image_url as string,
    p_link_url: normalizeOfferLink(f.link_url) ?? (f.link_url ?? '').trim(),
    p_country_ids: f.country_ids,
    p_area: (f.area ?? '').trim(),
    p_roles: f.roles,
    p_starts_at: f.starts_at as string,
    p_ends_at: f.ends_at as string,
    p_submit: submit,
    p_everywhere: f.everywhere ?? false,
    p_regions: f.regions ?? [],
    // Perk and code belong to an offer; another objective clears them.
    p_perk: f.objective && f.objective !== 'offer' ? '' : (f.perk ?? '').trim(),
    p_promo_code: f.objective && f.objective !== 'offer' ? '' : (f.promo_code ?? '').trim(),
  }
  const first = await supabase.rpc('save_brand_offer', { ...args, p_objective: f.objective ?? undefined })
  // A server that has not learned objectives yet (PGRST202: no such signature)
  // still saves an offer or a product, which it treats the same way.
  const serverIsOlder = first.error?.code === 'PGRST202' && !linkOptional(f.objective)
  const { data, error } = serverIsOlder ? await supabase.rpc('save_brand_offer', args) : first
  if (error) throw error
  return data as string
}

export async function setOfferState(offerId: string, action: OfferAction): Promise<string> {
  const { data, error } = await supabase.rpc('set_brand_offer_state', { p_offer_id: offerId, p_action: action })
  if (error) throw error
  return data as string
}

export async function duplicateOffer(offerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('duplicate_brand_offer', { p_offer_id: offerId })
  if (error) throw error
  return data as string
}

export async function fetchAdminOffers(tab: AdminOfferTab): Promise<AdminBrandOffer[]> {
  const { data, error } = await supabase.rpc('admin_list_brand_offers', { p_tab: tab })
  if (error) throw error
  return (data ?? []) as unknown as AdminBrandOffer[]
}

/** Admin: take a live or paused offer down; the brand sees the reason word for word. */
export async function takeDownOffer(offerId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_take_down_brand_offer', { p_offer_id: offerId, p_reason: reason.trim() })
  if (error) throw error
  return data as string
}

/** Plain words for a server refusal, so the brand never sees an error code. */
export function offerErrorMessage(err: unknown): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  if (msg.startsWith('live_limit')) return tBrands('offers.errors.liveLimit', { limit: OFFER_LIVE_LIMIT })
  if (msg.startsWith('campaign_window')) return tBrands('offers.missing.window', { min: CAMPAIGN_MIN_DAYS, max: CAMPAIGN_MAX_DAYS })
  if (msg.startsWith('invalid_offer: open_to_partners')) return tBrands('offers.errors.openToPartners')
  if (msg.startsWith('invalid_offer')) return tBrands('offers.errors.invalid')
  if (msg.startsWith('offer_expired')) return tBrands('offers.errors.expired')
  if (msg.startsWith('too_many_offers')) return tBrands('offers.errors.tooMany')
  if (msg.startsWith('reason_required')) return tBrands('offers.errors.reasonRequired')
  if (msg.startsWith('not_live')) return tBrands('offers.errors.notLive')
  return tBrands('offers.errors.generic')
}
