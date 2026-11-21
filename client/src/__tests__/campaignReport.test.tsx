import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => () => [] }))
vi.mock('@/hooks/useMyBrand', () => ({ useMyBrand: () => ({ brand: { name: 'Northline' } }) }))
vi.mock('@/hooks/useBrandOffers', () => ({ useMyBrandOffers: () => ({ offers: [], isLoading: false, duplicate: { isPending: false } }) }))

import { Report } from '@/pages/CampaignReportPage'
import { CampaignPreview } from '@/components/brands/offers/CampaignPreview'
import { EMPTY_OFFER, campaignCount, campaignHeadline, campaignRanDays, closingLine, offerCountsLine, offerStatusLine, type BrandOffer } from '@/lib/brandOffers'

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
  return render(<Report offer={offer} countryNames={[]} waiting={0} onMessages={noop} onResults={noop} onEdit={noop} onPreview={noop} onRunAgain={noop} runningAgain={false} {...over} />)
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
    expect(offerCountsLine({ shown: 8, opened: 6, contacted: 5, store_visits: 0, objective: 'ask' })).toBe('8 shown, 6 opened, 5 contacted')
    expect(offerCountsLine({ shown: 8, opened: 6, contacted: 5, store_visits: 0, objective: 'offer' })).toBe('8 shown, 6 opened, 0 went to your store, 5 contacted')
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
    // 2 members marked it not useful: a total from 1 to 4 is never exact.
    expect(rows.querySelector('[data-row="notUseful"]')?.textContent).toBe('Marked not usefulFewer than 5')
    expect(screen.queryByTestId('campaign-report-small')).toBeNull()
    expect(screen.queryByTestId('campaign-report-closing')).toBeNull()
  })

  it('under five members it gives no counts at all, so nobody\'s actions can be told apart', () => {
    renderReport(campaign({ shown: 3, opened: 1, contacted: 1, not_useful: 1 }))
    expect(screen.getByTestId('campaign-report-number').textContent).toBe('Fewer than 5')
    expect(screen.getByTestId('campaign-report-small').textContent).toBe('Fewer than 5 members have seen it so far. Counts appear once 5 have, so nobody’s actions can be told apart.')
    expect(screen.queryByTestId('campaign-report-rows')).toBeNull()
    // The list row and the ended line follow the same rule.
    expect(offerCountsLine({ shown: 3, opened: 1, contacted: 1, not_useful: 1 })).toBe('Fewer than 5 members have seen it')
    expect(offerStatusLine(campaign({ status: 'ended', shown: 1, opened: 1, ended_at: '2026-11-15T00:00:00Z' }))).toContain('Fewer than 5 members have seen it')
    expect(offerCountsLine({ shown: 5, opened: 5, contacted: 5, objective: 'ask' })).toBe('5 shown, 5 opened, 5 contacted')
  })

  it('every per-campaign total from 1 to 4 reads "Fewer than 5": the number, each row, the list row and the closing sentence', () => {
    expect([0, 1, 4, 5, 84].map(campaignCount)).toEqual(['0', 'Fewer than 5', 'Fewer than 5', '5', '84'])
    renderReport(campaign({ shown: 40, opened: 4, contacted: 3, not_useful: 0 }))
    expect(screen.getByTestId('campaign-report-number').textContent).toBe('Fewer than 5')
    expect(screen.getByTestId('campaign-report-headline').textContent).toContain('members wrote to you')
    const rows = screen.getByTestId('campaign-report-rows')
    expect(rows.querySelector('[data-row="shown"]')?.textContent).toBe('Shown to40')
    expect(rows.querySelector('[data-row="opened"]')?.textContent).toBe('OpenedFewer than 5')
    expect(rows.querySelector('[data-row="contacted"]')?.textContent).toBe('Wrote to youFewer than 5')
    // A zero beside an audience of five or more cannot be traced to a person.
    expect(rows.querySelector('[data-row="notUseful"]')?.textContent).toBe('Marked not useful0')
    expect(offerCountsLine({ shown: 40, opened: 4, contacted: 3, store_visits: 0, objective: 'ask' })).toBe('40 shown, fewer than 5 opened, fewer than 5 contacted')
    expect(closingLine({ shown: 40, opened: 4 }, 14, { key: 'asked', n: 3 })).toBe('It ran 14 days. It was shown to 40 members and fewer than 5 opened it. Fewer than 5 wrote to you.')
    expect(closingLine({ shown: 40, opened: 12 }, 14, { key: 'store', n: 2 })).toBe('It ran 14 days. It was shown to 40 members and 12 opened it. Fewer than 5 went to your store.')
  })

  it('nobody at all is a plain zero, said in words', () => {
    renderReport(campaign({ shown: 0, opened: 0, contacted: 0, not_useful: 0 }))
    expect(screen.getByTestId('campaign-report-number').textContent).toBe('0')
    expect(screen.getByTestId('campaign-report-nobody').textContent).toBe('Nobody has seen it yet.')
    expect(screen.getByTestId('campaign-report-rows')).toBeTruthy()
  })

  it('replies owed are the brand\'s inbox, not this campaign\'s number: worded so, below the report, on any campaign', () => {
    const onMessages = vi.fn()
    renderReport(campaign({ shown: 40, contacted: 0 }), { waiting: 3, onMessages })
    expect(screen.getByTestId('campaign-report-number').textContent).toBe('0')
    const inbox = screen.getByTestId('campaign-report-inbox')
    expect(inbox.textContent).toBe('In your inbox: 3 people are waiting for a replyReply')
    // It comes after the campaign's own numbers.
    expect(screen.getByTestId('campaign-report-rows').compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(inbox)
    expect(onMessages).toHaveBeenCalled()
  })

  it('an offer shows the store and the code', () => {
    renderReport(campaign({ objective: 'offer', link_url: 'https://shop.example.com', promo_code: 'HOCKIA15', store_visits: 12, code_copies: 4 }), { waiting: 2 })
    expect(screen.getByTestId('campaign-report-number').textContent).toBe('12')
    expect(screen.getByTestId('campaign-report-headline').textContent).toContain('members went to your store')
    const rows = screen.getByTestId('campaign-report-rows')
    expect(rows.querySelector('[data-row="store"]')?.textContent).toBe('Went to your store12')
    expect(rows.querySelector('[data-row="codes"]')?.textContent).toBe('Copied the codeFewer than 5')
  })

  it('an ended campaign closes with what happened and offers to run it again', () => {
    const onRunAgain = vi.fn()
    renderReport(campaign({ status: 'ended', starts_at: '2026-11-01T00:00:00Z', live_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-15T23:59:59Z', ended_at: '2026-11-15T00:00:00Z' }), { onRunAgain })
    expect(screen.getByTestId('campaign-report-closing').textContent).toContain('It ran 14 days. It was shown to 84 members and 19 opened it. 6 wrote to you.')
    expect(screen.queryByTestId('campaign-report-left')).toBeNull()
    fireEvent.click(screen.getByTestId('campaign-report-run-again'))
    expect(onRunAgain).toHaveBeenCalled()
  })

  it('names nobody: who wrote is read per brand, so the report links to Results instead of guessing by campaign', () => {
    const onResults = vi.fn()
    renderReport(campaign(), { onResults })
    expect(screen.queryByTestId('campaign-report-contacts')).toBeNull()
    fireEvent.click(screen.getByTestId('campaign-report-who'))
    expect(onResults).toHaveBeenCalled()
  })

  it('the closing sentence has a singular for every part and never says "0 days"', () => {
    const asked = (n: number) => ({ key: 'asked' as const, n })
    expect(closingLine({ shown: 84, opened: 19 }, 14, asked(6))).toBe('It ran 14 days. It was shown to 84 members and 19 opened it. 6 wrote to you.')
    expect(closingLine({ shown: 5, opened: 5 }, 1, asked(5))).toBe('It ran 1 day. It was shown to 5 members and 5 opened it. 5 wrote to you.')
    expect(closingLine({ shown: 6, opened: 0 }, 0, asked(0))).toBe('It ran less than a day. It was shown to 6 members and 0 opened it. 0 wrote to you.')
    expect(closingLine({ shown: 1, opened: 1 }, 7, asked(1))).toBe('It ran 7 days. Fewer than 5 members have seen it so far. Counts appear once 5 have, so nobody’s actions can be told apart.')
    expect(closingLine({ shown: 0, opened: 0 }, 7, asked(0))).toBe('It ran 7 days. Nobody has seen it yet.')
  })

  it('a campaign that ended without ever going live cannot be edited', () => {
    renderReport(campaign({ status: 'ended', live_at: null, starts_at: null, shown: 0, opened: 0, contacted: 0, not_useful: 0 }))
    expect(screen.getByTestId('campaign-report-not-started').textContent).toBe('This campaign ended without being published, so there is nothing to report.')
    expect(screen.queryByRole('button', { name: 'Edit campaign' })).toBeNull()
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
    render(<CampaignPreview fields={{ ...fields, objective: 'product', link_url: 'shop.example.com' }} brandName="Northline" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Hockia AI' }))
    const ai = screen.getByTestId('campaign-preview-ai')
    expect(ai.textContent).toContain('Your campaign never changes the answer.')
    // The real reason line names what the member asked; the preview does not pretend to know it.
    expect(ai.textContent).toContain('Shown because of what the member asked. It did not change the answer.')
    expect(screen.getByTestId('campaign-preview-note').textContent).toBe('Under a Hockia AI answer, when a member asks about gear, kit, training, camps, physio or moving abroad and your campaign is for them. The line names what they asked.')
  })

  it('opens on the Home card', () => {
    render(<CampaignPreview fields={{ ...fields, objective: 'ask' }} brandName="Northline" />)
    expect(screen.getByTestId('offer-preview')).toBeTruthy()
    expect(screen.getByTestId('campaign-preview-note').textContent).toBe('On Home, after the first post, for members it is for.')
  })
})
