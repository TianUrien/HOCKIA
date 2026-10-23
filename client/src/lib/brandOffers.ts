import { supabase } from '@/lib/supabase'

/**
 * Brand offers, Phase 1 (founder 2026-10-23; Figma page "08 · Brands (all
 * phases)", section P1; migration 20261023160000).
 *
 * An offer reaches members by WHERE THEY LIVE and their role, never by
 * nationality. Every offer is checked by an admin before it goes live. Up to
 * 5 live offers per brand while free (drafts and paused offers don't count).
 * An edit of a live / paused offer is a pending change with its own review;
 * the live version stays up until it is approved.
 */

export type OfferStatus = 'draft' | 'in_review' | 'not_approved' | 'live' | 'paused' | 'ended'
export type OfferRole = 'player' | 'coach' | 'club' | 'umpire'
export type OfferAction = 'pause' | 'resume' | 'end' | 'delete'

export const OFFER_LIVE_LIMIT = 5
export const OFFER_TITLE_MAX = 60
export const OFFER_BODY_MAX = 140
export const OFFER_ROLES: { value: OfferRole; label: string }[] = [
  { value: 'player', label: 'Players' },
  { value: 'coach', label: 'Coaches' },
  { value: 'club', label: 'Clubs' },
  { value: 'umpire', label: 'Umpires' },
]

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

export type AdminOfferTab = 'to_review' | 'not_approved' | 'live'

// ── Grouping and status words (B1-all) ─────────────────────────────────────

export type OfferGroup = 'needs_you' | 'live' | 'waiting' | 'paused_ended'

/** Which section of the brand's list an offer sits in (Figma B1-all). "Needs
 *  you" holds only what an admin sent back; drafts wait under "Waiting" with
 *  offers in review. */
export function offerGroup(o: Pick<BrandOffer, 'status' | 'pending_status'>): OfferGroup {
  if (o.status === 'not_approved' || o.pending_status === 'not_approved') return 'needs_you'
  if (o.status === 'in_review' || o.status === 'draft') return 'waiting'
  if (o.status === 'live') return 'live'
  return 'paused_ended'
}

export const OFFER_GROUP_LABELS: Record<OfferGroup, string> = {
  needs_you: 'Needs you',
  live: 'Live',
  waiting: 'Waiting',
  paused_ended: 'Paused and ended',
}

export type OfferPillTone = 'positive' | 'neutral' | 'amber' | 'muted'

/** The state pill: green only for Live, amber only where the brand must act. */
export function offerPill(o: Pick<BrandOffer, 'status' | 'pending_status'>): { label: string; tone: OfferPillTone } {
  if (o.status === 'not_approved') return { label: 'Not approved', tone: 'amber' }
  if (o.status === 'live' && o.pending_status === 'not_approved') return { label: 'Changes not approved', tone: 'amber' }
  switch (o.status) {
    case 'live': return { label: 'Live', tone: 'positive' }
    case 'in_review': return { label: 'In review', tone: 'neutral' }
    case 'draft': return { label: 'Draft', tone: 'neutral' }
    case 'paused': return { label: 'Paused', tone: 'muted' }
    default: return { label: 'Ended', tone: 'muted' }
  }
}

export function liveCount(offers: Pick<BrandOffer, 'status'>[]): number {
  return offers.filter((o) => o.status === 'live').length
}

export function liveLimitLine(offers: Pick<BrandOffer, 'status'>[]): string {
  return `${liveCount(offers)} of ${OFFER_LIVE_LIMIT} live · free for every brand for now`
}

/** "158 shown · 31 opened · 5 contacted" (live and paused rows only). */
export function offerCountsLine(o: Pick<BrandOffer, 'shown' | 'opened' | 'contacted'>): string {
  return `${o.shown} shown · ${o.opened} opened · ${o.contacted} contacted`
}

/** "today" / "yesterday" / "3 days ago" (B1 status lines). */
export function daysAgoWord(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'recently'
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(now) - start(new Date(iso))) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "30 Sep" (fixed words: some ICU versions write "Sept"). */
export const shortDate = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` }

/** The line beside the pill on a list row (Figma B1-all). */
export function offerStatusLine(o: BrandOffer, now: Date = new Date()): string {
  const note = (o.review_note ?? '').trim().replace(/[.!]+$/, '')
  // A change to a live / paused offer: one row, the live version plus a line on the change (Figma session note 2026-10-23).
  if (o.pending_status === 'not_approved') return note ? `Changes not approved: ${note}. Edit and send again.` : 'Changes not approved. Edit and send again.'
  if (o.pending_status === 'in_review') return `${o.status === 'live' ? `${offerCountsLine(o)} · ` : ''}Changes in review`
  if (o.status === 'not_approved') return note ? `Reason: ${note}. Edit and send again.` : 'Edit and send again.'
  switch (o.status) {
    case 'live': return offerCountsLine(o)
    case 'in_review': return `Sent ${daysAgoWord(o.submitted_at, now)}. You can still edit it.`
    case 'draft': return 'Not sent yet'
    case 'paused': return `Paused ${daysAgoWord(o.updated_at, now)}. Members don't see it.`
    default: return `Ended ${shortDate(o.ended_at ?? o.updated_at)} · ${o.shown} shown · ${o.contacted} contacted`
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
  }
}

export const EMPTY_OFFER: OfferFields = {
  title: '', body: '', image_url: null, link_url: '', country_ids: [], area: '', roles: [], starts_at: null, ends_at: null,
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

/** Words the brand can't claim without proof (B2 helper; the admin checks the rest). */
const UNPROVABLE = /\b(best|cheapest|lowest price|number one|no\.? ?1|guaranteed)\b/i
export function unprovableClaim(text: string | null | undefined): string | null {
  const m = (text ?? '').match(UNPROVABLE)
  return m ? m[0] : null
}

/** What still blocks "Send for review", in the editor's order, or null. */
export function offerMissing(f: OfferFields): string | null {
  if (!f.title?.trim()) return 'Add a title'
  if (f.title.trim().length > OFFER_TITLE_MAX) return `Keep the title under ${OFFER_TITLE_MAX} characters`
  if (!f.body?.trim()) return 'Say what members get'
  if (f.body.trim().length > OFFER_BODY_MAX) return `Keep it under ${OFFER_BODY_MAX} characters`
  if (!normalizeOfferLink(f.link_url)) return 'Add a link that starts with https'
  if (f.country_ids.length === 0) return 'Choose at least one country'
  if (f.roles.length === 0) return 'Choose who it is for'
  if (f.ends_at && new Date(f.ends_at).getTime() <= Date.now()) return 'Choose an end date in the future'
  return null
}

// ── The reason line (shown with every offer) ────────────────────────────────

const ROLE_VERB: Record<OfferRole, string> = { player: 'play', coach: 'coach', club: 'run a club', umpire: 'umpire' }

/**
 * "You see this because you live in England and play." Location and role
 * only, never nationality; no goal until goals are stored (founder 2026-10-23).
 */
export function offerReasonLine(countryName: string | null, role: string | null | undefined): string {
  const verb = role && role in ROLE_VERB ? ROLE_VERB[role as OfferRole] : null
  if (countryName && verb) return `You see this because you live in ${countryName} and ${verb}.`
  if (countryName) return `You see this because you live in ${countryName}.`
  return 'You see this because of where you live.'
}

/** "England, Netherlands · Players, coaches" for list rows. */
export function audienceLine(countryNames: string[], roles: OfferRole[]): string {
  const who = roles.map((r) => OFFER_ROLES.find((x) => x.value === r)?.label ?? r)
  const whoText = who.length ? who[0] + (who.length > 1 ? ', ' + who.slice(1).map((w) => w.toLowerCase()).join(', ') : '') : ''
  return [countryNames.join(', '), whoText].filter(Boolean).join(' · ')
}

// ── Server calls ────────────────────────────────────────────────────────────

export async function fetchMyOffers(): Promise<BrandOffer[]> {
  const { data, error } = await supabase.rpc('get_my_brand_offers')
  if (error) throw error
  return (data ?? []) as unknown as BrandOffer[]
}

export async function saveOffer(offerId: string | null, f: OfferFields, submit: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('save_brand_offer', {
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
  })
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

export async function reviewOffer(offerId: string, decision: 'approve' | 'reject', note: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('admin_review_brand_offer', {
    p_offer_id: offerId,
    p_decision: decision,
    p_note: (note ?? '').trim() || (null as unknown as string),
  })
  if (error) throw error
  return data as string
}

/** Plain words for a server refusal, so the brand never sees an error code. */
export function offerErrorMessage(err: unknown): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  if (msg.startsWith('live_limit')) return `You already have ${OFFER_LIVE_LIMIT} live offers. Pause one first.`
  if (msg.startsWith('invalid_offer')) return 'Some details are missing or not valid. Check the offer and try again.'
  if (msg.startsWith('offer_expired')) return 'This offer has passed its end date. Change the dates first.'
  if (msg.startsWith('too_many_offers')) return 'You have a lot of offers. End some you no longer need.'
  if (msg.startsWith('reason_required')) return 'Write the reason the brand will see.'
  return 'Something went wrong. Please try again.'
}
