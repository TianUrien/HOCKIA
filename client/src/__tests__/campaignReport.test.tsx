import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => () => [] }))
vi.mock('@/hooks/useMyBrand', () => ({ useMyBrand: () => ({ brand: { name: 'Northline' } }) }))
vi.mock('@/hooks/useBrandOffers', () => ({ useMyBrandOffers: () => ({ offers: [], isLoading: false, duplicate: { isPending: false } }) }))

import { Report } from '@/pages/CampaignReportPage'
import { CampaignPreview } from '@/components/brands/offers/CampaignPreview'
import { EMPTY_OFFER, campaignHeadline, campaignRanDays, offerCountsLine, type BrandOffer } from '@/lib/brandOffers'

/**
 * The per-campaign report and the three-place preview (founder 2026-11-21):
 * one number judged by the objective, counts for the campaign's whole window,
 * words instead of charts when few members have seen it.
 */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
function campaign(over: Partial<BrandOffer> = {}): BrandOffer {
  return {
    id: 'o1', status: 'live', title: 'Questions about sticks?', body: 'Write to us.', image_url: 'https://cdn.example.com/k.jpg', link_url: null,
    country_ids: [], area: null, roles: ['player'], starts_at: day(-9), ends_at: day(5), everywhere: true, regions: [], perk: null, promo_code: null, objective: 'ask',
    pending: null, pending_status: null, review_note: null, submitted_at: day(-9), live_at: day(-9), ended_at: null,
    created_at: day(-9), updated_at: day(-9), shown: 84, opened: 19, contacted: 6, not_useful: 2, store_visits: 0, code_copies: 0, ...over,
  }
}
const noop = () => undefined
function renderReport(offer: BrandOffer, over: Partial<Parameters<typeof Report>[0]> = {}) {
  return render(<Report offer={offer} countryNames={[]} waiting={0} contacts={[]} onMessages={noop} onOpenContact={noop} onEdit={noop} onPreview={noop} onRunAgain={noop} runningAgain={false} {...over} />)
}

describe('the one number follows the objective', () => {
  it('a question counts who wrote, ambassadors who applied, a product or an offer who went to the store', () => {
    expect(campaignHeadline({ objective: 'ask', contacted: 6, store_visits: 3 })).toEqual({ key: 'asked', n: 6 })
    expect(campaignHeadline({ objective: 'ambassador', contacted: 2, store_visits: 0 })).toEqual({ key: 'applied', n: 2 })
    expect(campaignHeadline({ objective: 'product', contacted: 6, store_visits: 3 })).toEqual({ key: 'store', n: 3 })
    expect(campaignHeadline({ objective: 'offer', contacted: 6, store_visits: 3 })).toEqual({ key: 'store', n: 3 })
    // A campaign saved before objectives existed is an offer.
    expect(campaignHeadline({ contacted: 6, store_visits: 3 })).toEqual({ key: 'store', n: 3 })
  })

  it('the list row of a question campaign does not talk about a store', () => {
    expect(offerCountsLine({ shown: 8, opened: 2, contacted: 1, store_visits: 0, objective: 'ask' })).toBe('8 shown, 2 opened, 1 contacted')
    expect(offerCountsLine({ shown: 8, opened: 2, contacted: 1, store_visits: 0, objective: 'offer' })).toBe('8 shown, 2 opened, 0 went to your store, 1 contacted')
  })

  it('counts the days it ran from the day it went live', () => {
    expect(campaignRanDays(campaign())).toBe(9)
    expect(campaignRanDays(campaign({ status: 'ended', starts_at: '2026-11-01T00:00:00Z', ended_at: '2026-11-15T00:00:00Z' }))).toBe(14)
    expect(campaignRanDays(campaign({ live_at: null, starts_at: null }))).toBeNull()
  })
})

describe('campaign report', () => {
  it('a running question campaign: who wrote is the number, no store row, days left, no closing summary', () => {
    renderReport(campaign())
    expect(screen.getByTestId('campaign-report-objective').textContent).toBe('Ask you a question')
    expect(screen.getByTestId('campaign-report-number').textContent).toBe('6')
    expect(screen.getByTestId('campaign-report-headline').textContent).toContain('members wrote to you')
    expect(screen.getByTestId('campaign-report-left').textContent).toBe('5 days left')
    const rows = screen.getByTestId('campaign-report-rows')
    expect(rows.querySelector('[data-row="store"]')).toBeNull()
    expect(within(rows).getByText('Shown to')).toBeTruthy()
    expect(rows.querySelector('[data-row="notUseful"]')?.textContent).toBe('Marked not useful2')
    expect(screen.queryByTestId('campaign-report-small')).toBeNull()
    expect(screen.queryByTestId('campaign-report-closing')).toBeNull()
  })

  it('says so in words when fewer than five members have seen it', () => {
    renderReport(campaign({ shown: 3, opened: 1, contacted: 0, not_useful: 0 }))
    expect(screen.getByTestId('campaign-report-small').textContent).toBe('Fewer than 5 members have seen it so far. The numbers say little until more do.')
  })

  it('amber only when the brand must act: people waiting for a reply on a campaign that asks members to write', () => {
    const onMessages = vi.fn()
    renderReport(campaign(), { waiting: 2, onMessages })
    const waiting = screen.getByTestId('campaign-report-waiting')
    expect(waiting.textContent).toBe('2 people are waiting for your replyReply')
    fireEvent.click(waiting)
    expect(onMessages).toHaveBeenCalled()
  })

  it('an offer shows the store and the code, and never the waiting row', () => {
    renderReport(campaign({ objective: 'offer', link_url: 'https://shop.example.com', promo_code: 'HOCKIA15', store_visits: 12, code_copies: 4 }), { waiting: 2 })
    expect(screen.getByTestId('campaign-report-number').textContent).toBe('12')
    expect(screen.getByTestId('campaign-report-headline').textContent).toContain('members went to your store')
    const rows = screen.getByTestId('campaign-report-rows')
    expect(rows.querySelector('[data-row="store"]')?.textContent).toBe('Went to your store12')
    expect(rows.querySelector('[data-row="codes"]')?.textContent).toBe('Copied the code4')
    expect(screen.queryByTestId('campaign-report-waiting')).toBeNull()
  })

  it('an ended campaign closes with what happened and offers to run it again', () => {
    const onRunAgain = vi.fn()
    renderReport(campaign({ status: 'ended', starts_at: '2026-11-01T00:00:00Z', live_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-15T23:59:59Z', ended_at: '2026-11-15T00:00:00Z' }), { onRunAgain })
    expect(screen.getByTestId('campaign-report-closing').textContent).toContain('It ran 14 days. It was shown to 84 members and 19 opened it. 6 wrote to you.')
    expect(screen.queryByTestId('campaign-report-left')).toBeNull()
    fireEvent.click(screen.getByTestId('campaign-report-run-again'))
    expect(onRunAgain).toHaveBeenCalled()
  })

  it('names only the people who wrote to the brand', () => {
    const onOpenContact = vi.fn()
    renderReport(campaign(), { contacts: [{ profile_id: 'p1', full_name: 'Ana Example', avatar_url: null, role: 'player', conversation_id: 'c1' }], onOpenContact })
    const list = screen.getByTestId('campaign-report-contacts')
    expect(within(list).getByText('Ana Example')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: 'Message' }))
    expect(onOpenContact).toHaveBeenCalledWith('c1', 'p1')
  })

  it('a draft has nothing to report', () => {
    renderReport(campaign({ status: 'draft', live_at: null, starts_at: null, shown: 0, opened: 0, contacted: 0, not_useful: 0 }))
    expect(screen.getByTestId('campaign-report-not-started')).toBeTruthy()
    expect(screen.queryByTestId('campaign-report-headline')).toBeNull()
  })
})

describe('campaign preview in the three places a member meets it', () => {
  const fields = { ...EMPTY_OFFER, title: 'Questions about sticks?', body: 'Write to us.', roles: ['player' as const], everywhere: true, ends_at: '2026-12-05T23:59:59Z' }

  it('the page shows the button the objective gives', () => {
    const { rerender } = render(<CampaignPreview fields={{ ...fields, objective: 'ask', link_url: '' }} brandName="Northline" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Page' }))
    expect(screen.getByTestId('campaign-preview-actions').textContent).toBe('Ask Northline')

    rerender(<CampaignPreview fields={{ ...fields, objective: 'ask', link_url: 'shop.example.com' }} brandName="Northline" />)
    expect(screen.getByTestId('campaign-preview-actions').textContent).toBe('Ask NorthlineOpen link')

    rerender(<CampaignPreview fields={{ ...fields, objective: 'offer', link_url: 'shop.example.com', perk: '15% off', promo_code: 'HOCKIA15' }} brandName="Northline" />)
    expect(screen.getByTestId('campaign-preview-actions').textContent).toBe('Go to storeMessage Northline')
    expect(screen.getByTestId('campaign-preview-page').textContent).toContain('HOCKIA15')

    rerender(<CampaignPreview fields={{ ...fields, objective: 'ambassador', link_url: '' }} brandName="Northline" />)
    expect(screen.getByTestId('campaign-preview-actions').textContent).toBe('Apply as ambassador')
  })

  it('under Hockia AI it says the answer never changes and when the card appears', () => {
    render(<CampaignPreview fields={{ ...fields, objective: 'product', link_url: 'shop.example.com' }} brandName="Northline" need="moving_abroad" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Hockia AI' }))
    const ai = screen.getByTestId('campaign-preview-ai')
    expect(ai.textContent).toContain('Your campaign never changes the answer.')
    expect(ai.textContent).toContain('It did not change the answer.')
    expect(screen.getByTestId('campaign-preview-note').textContent).toBe('Under a Hockia AI answer, only when a member asks about this topic.')
  })

  it('opens on the Home card', () => {
    render(<CampaignPreview fields={{ ...fields, objective: 'ask' }} brandName="Northline" />)
    expect(screen.getByTestId('offer-preview')).toBeTruthy()
    expect(screen.getByTestId('campaign-preview-note').textContent).toBe('On Home, after the first post, for members it is for.')
  })
})
