import { describe, expect, it, vi } from 'vitest'

// No Supabase env in CI: the RPC wrappers are not exercised here.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import {
  OFFER_LIVE_LIMIT,
  audienceLine,
  daysAgoWord,
  liveLimitLine,
  normalizeOfferLink,
  offerErrorMessage,
  offerGroup,
  offerMissing,
  offerPill,
  offerReasonLine,
  offerShownFields,
  offerStatusLine,
  shortDate,
  unprovableClaim,
  type BrandOffer,
} from '@/lib/brandOffers'
import { getNotificationConfig } from '@/components/notifications/config'
import type { NotificationRecord } from '@/lib/api/notifications'
import { buildPushPayload } from '../../../supabase/functions/send-push/push-payload.ts'

const NOW = new Date('2026-10-23T12:00:00Z')

function offer(over: Partial<BrandOffer> = {}): BrandOffer {
  return {
    id: 'o1', status: 'live', pending: null, pending_status: null, review_note: null,
    title: 'Kit for your first season abroad', body: '15% off your first full kit.', image_url: null,
    link_url: 'https://northlinehockey.com/hockia', country_ids: [1], area: null, roles: ['player'],
    starts_at: null, ends_at: null, submitted_at: '2026-10-23T08:00:00Z', live_at: null, ended_at: null,
    created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T10:00:00Z',
    shown: 158, opened: 31, contacted: 5, not_useful: 0,
    ...over,
  }
}

describe('brand offers: list groups and words (Figma B1-all)', () => {
  it('puts only what an admin sent back under Needs you; drafts wait with offers in review', () => {
    expect(offerGroup(offer({ status: 'not_approved' }))).toBe('needs_you')
    expect(offerGroup(offer({ status: 'live', pending_status: 'not_approved' }))).toBe('needs_you')
    expect(offerGroup(offer({ status: 'draft' }))).toBe('waiting')
    expect(offerGroup(offer({ status: 'in_review' }))).toBe('waiting')
    expect(offerGroup(offer({ status: 'live' }))).toBe('live')
    expect(offerGroup(offer({ status: 'paused' }))).toBe('paused_ended')
    expect(offerGroup(offer({ status: 'ended' }))).toBe('paused_ended')
  })

  it('uses amber only where the brand must act and green only for live', () => {
    expect(offerPill(offer({ status: 'not_approved' }))).toEqual({ label: 'Not approved', tone: 'amber' })
    expect(offerPill(offer({ status: 'live' })).tone).toBe('positive')
    expect(offerPill(offer({ status: 'in_review' })).tone).toBe('neutral')
    expect(offerPill(offer({ status: 'paused' })).tone).toBe('muted')
  })

  it('writes the status line for each state', () => {
    expect(offerStatusLine(offer(), NOW)).toBe('158 shown · 31 opened · 5 contacted')
    expect(offerStatusLine(offer({ status: 'in_review' }), NOW)).toBe('Sent today. You can still edit it.')
    expect(offerStatusLine(offer({ status: 'draft' }), NOW)).toBe('Not sent yet')
    expect(offerStatusLine(offer({ status: 'paused', updated_at: '2026-10-20T10:00:00Z' }), NOW)).toBe("Paused 3 days ago. Members don't see it.")
    expect(offerStatusLine(offer({ status: 'not_approved', review_note: 'remove "best price in Spain".' }), NOW)).toBe('Reason: remove "best price in Spain". Edit and send again.')
    expect(offerStatusLine(offer({ pending_status: 'in_review' }), NOW)).toBe('158 shown · 31 opened · 5 contacted · Changes in review')
    expect(offerStatusLine(offer({ pending_status: 'not_approved', review_note: 'no claims.' }), NOW)).toBe('Changes not approved: no claims. Edit and send again.')
    expect(shortDate('2027-07-31T23:59:59Z')).toBe('31 Jul')
    expect(offerStatusLine(offer({ status: 'ended', ended_at: '2026-09-30T10:00:00Z', shown: 212, contacted: 9 }), NOW)).toBe('Ended 30 Sep · 212 shown · 9 contacted')
  })

  it('counts live offers against the free limit', () => {
    expect(liveLimitLine([offer(), offer({ status: 'draft' }), offer()])).toBe(`2 of ${OFFER_LIVE_LIMIT} live · free for every brand for now`)
  })

  it('says yesterday and N days ago', () => {
    expect(daysAgoWord('2026-10-22T12:00:00Z', NOW)).toBe('yesterday')
    expect(daysAgoWord(null, NOW)).toBe('recently')
  })

  it('shows the pending change over the live copy', () => {
    expect(offerShownFields(offer({ pending: { title: 'New title' } })).title).toBe('New title')
  })
})

describe('brand offers: content rules (Figma B2)', () => {
  it('accepts only https links, adding the scheme when missing', () => {
    expect(normalizeOfferLink('northlinehockey.com/hockia')).toBe('https://northlinehockey.com/hockia')
    expect(normalizeOfferLink('http://northlinehockey.com')).toBeNull()
    expect(normalizeOfferLink('javascript:alert(1)')).toBeNull()
    expect(normalizeOfferLink('https://user:pw@shop.com')).toBeNull()
    expect(normalizeOfferLink('not a link')).toBeNull()
  })

  it('flags claims an admin cannot check', () => {
    expect(unprovableClaim('The best camp in Ireland')).toBe('best')
    expect(unprovableClaim('Reserved places at our July camp')).toBeNull()
  })

  it('names the first thing missing before Send for review', () => {
    const base = offerShownFields(offer())
    expect(offerMissing(base)).toBeNull()
    expect(offerMissing({ ...base, title: ' ' })).toBe('Add a title')
    expect(offerMissing({ ...base, link_url: 'http://x.com' })).toBe('Add a link that starts with https')
    expect(offerMissing({ ...base, country_ids: [] })).toBe('Choose at least one country')
    expect(offerMissing({ ...base, roles: [] })).toBe('Choose who it is for')
  })

  it('explains why a member sees it by location and role, never nationality', () => {
    expect(offerReasonLine('England', 'player')).toBe('You see this because you live in England and play.')
    expect(offerReasonLine('Spain', 'club')).toBe('You see this because you live in Spain and run a club.')
    expect(offerReasonLine(null, 'coach')).toBe('You see this because of where you live.')
    expect(audienceLine(['England', 'Netherlands'], ['player', 'coach'])).toBe('England, Netherlands · Players, coaches')
  })

  it('turns server refusals into plain words', () => {
    expect(offerErrorMessage({ message: 'live_limit: brand has 5 live offers' })).toMatch(/5 live offers/)
    expect(offerErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.')
  })
})

describe('brand offers: review notices (Figma N1 / N2)', () => {
  const note = (kind: 'brand_offer_approved' | 'brand_offer_not_approved', metadata: Record<string, unknown>) =>
    ({ id: 'n', kind, sourceEntityId: 'o1', metadata, targetUrl: '/dashboard/offers', createdAt: NOW.toISOString(), readAt: null, seenAt: null, clearedAt: null, actor: null } as unknown as NotificationRecord)

  it('tells the brand an offer is live, in the Inbox and by push', () => {
    const n = note('brand_offer_approved', { offer_title: 'Kit for your first season abroad', change: false })
    const cfg = getNotificationConfig(n)
    expect(cfg.getTitle(n)).toBe('Your offer is live')
    expect(cfg.getDescription?.(n)).toBe('"Kit for your first season abroad" is now shown to members.')
    expect(cfg.getRoute?.(n)).toBe('/dashboard/offers')
    const push = buildPushPayload('brand_offer_approved', { offer_title: 'Kit for your first season abroad' }, 'HOCKIA')
    expect(push.title).toBe('Your offer is live')
    expect(push.url).toBe('/dashboard/offers')
  })

  it('passes the admin reason word for word when not approved', () => {
    const n = note('brand_offer_not_approved', { offer_title: 'Summer camp places', reason: 'Remove "the best camp in Ireland".' })
    const cfg = getNotificationConfig(n)
    expect(cfg.getTitle(n)).toBe('Your offer needs a change')
    expect(cfg.getDescription?.(n)).toBe('"Summer camp places" wasn’t approved. Reason: Remove "the best camp in Ireland".')
    expect(buildPushPayload('brand_offer_not_approved', { offer_title: 'Summer camp places' }, 'HOCKIA').body).toBe('Summer camp places: see the reason and send it again.')
  })
})
