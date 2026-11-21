import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const h = vi.hoisted(() => ({ offers: [] as unknown[], waiting: 0, isError: false, rpc: vi.fn(), track: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => h.rpc(...a) } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...a: unknown[]) => h.track(...a) }))
vi.mock('@/hooks/useBrandOffers', () => ({ useMyBrandOffers: () => ({ offers: h.offers, isLoading: false, isError: h.isError }) }))
vi.mock('@/lib/brandResults', async (orig) => ({ ...(await orig<typeof import('@/lib/brandResults')>()), fetchBrandResults: () => Promise.resolve({ waiting: { count: h.waiting, oldest_at: null }, contacts: [] }) }))
vi.mock('@/components/hockiaAi/mascot', () => ({ MascotAvatar: () => null }))

import { CampaignDesk } from '@/components/hockiaAi/CampaignDesk'
import { deskCampaigns, type BrandOffer } from '@/lib/brandOffers'
import { roleOptionsFor } from '@/lib/hockiaAi'
import { announcedCampaigns, firstUnseen, loadSuggestions, nextEndedCampaign, type SeenSignatures } from '@/lib/hockiaAiSuggestion'

/**
 * A brand's campaigns answered inside Hockia AI (founder 2026-11-21, step B):
 * cards built from the brand's own results, never from the language model.
 */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
function campaign(over: Partial<BrandOffer> = {}): BrandOffer {
  return {
    id: 'o1', status: 'live', title: 'Questions about sticks?', body: 'Write to us.', image_url: null, link_url: null,
    country_ids: [], area: null, roles: ['player'], starts_at: day(-9), ends_at: day(5), everywhere: true, regions: [], perk: null, promo_code: null, objective: 'ask',
    pending: null, pending_status: null, review_note: null, submitted_at: day(-9), live_at: day(-9), ended_at: null,
    created_at: day(-9), updated_at: day(-9), shown: 84, opened: 19, contacted: 6, not_useful: 2, store_visits: 0, code_copies: 0, ...over,
  }
}
function renderDesk(onGo = vi.fn(), focusId: string | null = null) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CampaignDesk onGo={onGo} focusId={focusId} /></QueryClientProvider>)
  return onGo
}

beforeEach(() => { h.offers = []; h.waiting = 0; h.isError = false; h.rpc.mockReset(); h.track.mockReset() })

describe('the brand option', () => {
  it('"How are my campaigns doing?" is answered in the sheet, not by leaving for a screen', () => {
    const options = roleOptionsFor({ role: 'brand' })
    const o = options?.find((x) => x.label === 'How are my campaigns doing?')
    expect(o?.eyebrow).toBe('ASK')
    expect(o?.action).toEqual({ type: 'campaigns' })
  })
})

describe('which campaigns get a card', () => {
  it('live and paused first, then the most recently ended; drafts never; three at most', () => {
    const list = [
      campaign({ id: 'draft', status: 'draft', live_at: null }),
      campaign({ id: 'old', status: 'ended', ended_at: day(-30) }),
      campaign({ id: 'recent', status: 'ended', ended_at: day(-2) }),
      campaign({ id: 'live', status: 'live' }),
      campaign({ id: 'paused', status: 'paused' }),
    ]
    expect(deskCampaigns(list).map((o) => o.id)).toEqual(['live', 'paused', 'recent'])
  })

  it('the campaign the dot announced always has a card, first, even behind three running ones', () => {
    const list = [
      campaign({ id: 'l1' }), campaign({ id: 'l2' }), campaign({ id: 'l3' }),
      campaign({ id: 'just-ended', status: 'ended', ended_at: day(-1) }),
    ]
    expect(deskCampaigns(list).map((o) => o.id)).toEqual(['l1', 'l2', 'l3'])
    expect(deskCampaigns(list, 'just-ended').map((o) => o.id)).toEqual(['just-ended', 'l1', 'l2'])
    // A focus that is not one of the brand's campaigns changes nothing.
    expect(deskCampaigns(list, 'unknown').map((o) => o.id)).toEqual(['l1', 'l2', 'l3'])
  })
})

describe('campaigns inside Hockia AI', () => {
  it('a running question campaign: its number, three counts and the way to its report', () => {
    h.offers = [campaign()]
    const onGo = renderDesk()
    expect(screen.getByTestId('ai-user-bubble').textContent).toBe('How are my campaigns doing?')
    expect(screen.getByTestId('hockia-ai-campaigns-lead').textContent).toBe('You have 1 live campaign.')
    const card = screen.getByTestId('hockia-ai-campaign-card')
    expect(within(card).getByTestId('hockia-ai-campaign-number').textContent).toBe('6')
    expect(card.textContent).toContain('members wrote to you')
    expect(card.textContent).toContain('Ask you a question. 5 days left')
    expect(within(card).getByTestId('hockia-ai-campaign-reading').textContent).toBe('Shown to 84 members so far; 19 opened it.')
    expect(screen.queryByTestId('hockia-ai-campaigns-inbox')).toBeNull()
    fireEvent.click(within(card).getByTestId('hockia-ai-campaign-report'))
    expect(onGo).toHaveBeenCalledWith('/dashboard/offers/o1/report')
    expect(h.track).toHaveBeenCalledWith('hockia_ai_campaigns_view', undefined, undefined, { cards: 1 })
    // The answer is read from the brand's results: the language model is never called.
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('under five members a card gives no counts, so nobody\'s actions can be told apart', () => {
    h.offers = [campaign({ shown: 3, opened: 1, contacted: 1, not_useful: 1 })]
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaign-number').textContent).toBe('Fewer than 5')
    expect(screen.queryByTestId('hockia-ai-campaign-cells')).toBeNull()
    expect(screen.getByTestId('hockia-ai-campaign-reading').textContent).toBe('Fewer than 5 members have seen it so far. Counts appear once 5 have, so nobody’s actions can be told apart.')
  })

  it('replies owed are the brand\'s inbox: said once above the cards, never as a campaign\'s number', async () => {
    h.offers = [campaign(), campaign({ id: 'o2', objective: 'offer', link_url: 'https://shop.example.com', store_visits: 4 })]
    h.waiting = 2
    const onGo = renderDesk()
    const inbox = await screen.findByTestId('hockia-ai-campaigns-inbox')
    expect(inbox.textContent).toBe('In your inbox: 2 people are waiting for a replyReply')
    expect(screen.getAllByTestId('hockia-ai-campaigns-inbox')).toHaveLength(1)
    expect(screen.getAllByTestId('hockia-ai-campaign-card')).toHaveLength(2)
    fireEvent.click(inbox)
    expect(onGo).toHaveBeenCalledWith('/messages')
  })

  it('an ended campaign closes with what happened', () => {
    h.offers = [campaign({ id: 'e1', status: 'ended', objective: 'offer', link_url: 'https://shop.example.com', store_visits: 12, starts_at: '2026-11-01T00:00:00Z', live_at: '2026-11-01T00:00:00Z', ended_at: '2026-11-15T00:00:00Z' })]
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaigns-lead').textContent).toBe('Nothing is live right now. Here is how your last campaigns went.')
    expect(screen.getByTestId('hockia-ai-campaign-reading').textContent).toBe('It ran 14 days. It was shown to 84 members and 19 opened it. 12 went to your store.')
    expect(screen.getByTestId('hockia-ai-campaign-number').textContent).toBe('12')
  })

  it('a total from 1 to 4 reads "Fewer than 5" on the card too: the number, the cells and the reading line', () => {
    h.offers = [campaign({ shown: 40, opened: 4, contacted: 3, not_useful: 0 })]
    renderDesk()
    const card = screen.getByTestId('hockia-ai-campaign-card')
    expect(within(card).getByTestId('hockia-ai-campaign-number').textContent).toBe('Fewer than 5')
    expect(within(card).getByTestId('hockia-ai-campaign-cells').textContent).toBe('Shown to40OpenedFewer than 5Not useful0')
    expect(within(card).getByTestId('hockia-ai-campaign-reading').textContent).toBe('Shown to 40 members so far; fewer than 5 opened it.')
  })

  it('a campaign nobody has seen says so', () => {
    h.offers = [campaign({ shown: 0, opened: 0, contacted: 0, not_useful: 0 })]
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaign-number').textContent).toBe('0')
    expect(screen.getByTestId('hockia-ai-campaign-reading').textContent).toBe('Nobody has seen it yet.')
  })

  it('with no campaigns it says so and offers to start one; no cards means no "cards shown" event and no source line', () => {
    const onGo = renderDesk()
    expect(h.track).not.toHaveBeenCalledWith('hockia_ai_campaigns_view', undefined, undefined, expect.anything())
    expect(screen.queryByTestId('hockia-ai-campaigns-source')).toBeNull()
    expect(screen.getByTestId('hockia-ai-campaigns-lead').textContent).toBe('You have no campaigns yet. A campaign brings your brand to the members it is for.')
    expect(screen.queryByTestId('hockia-ai-campaign-card')).toBeNull()
    fireEvent.click(screen.getByTestId('hockia-ai-campaigns-new'))
    expect(onGo).toHaveBeenCalledWith('/dashboard/offers/new')
  })
})

describe('what the first line says against the cards under it', () => {
  it('more campaigns than cards: it says how many are shown', () => {
    h.offers = ['a', 'b', 'c', 'd', 'e'].map((id) => campaign({ id }))
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaigns-lead').textContent).toBe('You have 5 live campaigns. Here are 3 of your 5 campaigns.')
    expect(screen.getAllByTestId('hockia-ai-campaign-card')).toHaveLength(3)
  })

  it('only paused campaigns: it does not call them ended', () => {
    h.offers = [campaign({ id: 'p1', status: 'paused' })]
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaigns-lead').textContent).toBe('Nothing is live right now. You have 1 paused campaign.')
  })

  it('opened from the dot, the announced campaign is the first card', () => {
    h.offers = [campaign({ id: 'l1', title: 'Live one' }), campaign({ id: 'l2' }), campaign({ id: 'l3' }), campaign({ id: 'gone', title: 'Just ended', status: 'ended', ended_at: day(-1) })]
    renderDesk(vi.fn(), 'gone')
    const cards = screen.getAllByTestId('hockia-ai-campaign-card')
    expect(cards[0].textContent).toContain('Just ended')
    expect(cards[0].getAttribute('data-status')).toBe('ended')
  })

  it('a failed refresh with campaigns already in hand shows them, not an error above them', () => {
    h.offers = [campaign()]
    h.isError = true
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaigns-lead').textContent).toBe('You have 1 live campaign.')
    expect(screen.getByTestId('hockia-ai-campaigns-source')).toBeTruthy()
  })

  it('a failed read with nothing to show says so, with no source line', () => {
    h.isError = true
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaigns-lead').textContent).toBe('I could not read your campaigns right now. Try again in a moment.')
    expect(screen.queryByTestId('hockia-ai-campaigns-source')).toBeNull()
  })

  it('opened only from a shared link: the card does not say nobody saw it', () => {
    h.offers = [campaign({ shown: 0, opened: 7, contacted: 6, not_useful: 0 })]
    renderDesk()
    expect(screen.getByTestId('hockia-ai-campaign-number').textContent).toBe('6')
    expect(screen.getByTestId('hockia-ai-campaign-reading').textContent).toBe('It has not been shown inside Hockia yet. The members counted here opened it from a link.')
  })
})

describe('the dot for a brand', () => {
  const brand = { id: 'b1', role: 'brand' }
  const rows = (...r: [string, string, number][]) => r.map(([id, title, ago]) => ({ id, status: 'ended', title, live_at: day(ago - 14), ended_at: day(ago) }))
  /** What a device goes through: load, light the dot if unseen, open Hockia AI (which stores the signature). */
  const cycle = async (seen: SeenSignatures) => {
    const fresh = firstUnseen(await loadSuggestions(brand, seen), seen)
    return { fresh, seen: fresh ? { ...seen, [fresh.kind]: fresh.signature } : seen }
  }

  it('lights for a campaign that ended in the last two weeks, and stays dark once it has been seen', async () => {
    h.rpc.mockResolvedValue({ data: [
      { id: 'old', status: 'ended', title: 'Old', live_at: day(-60), ended_at: day(-40) },
      { id: 'new', status: 'ended', title: 'Stick questions', live_at: day(-16), ended_at: day(-2) },
      { id: 'live', status: 'live', title: 'Live', live_at: day(-1), ended_at: null },
    ], error: null })
    const first = await cycle({})
    expect(first.fresh).toMatchObject({ kind: 'campaign_ended', id: 'new', title: 'Stick questions' })
    const second = await cycle(first.seen)
    expect(second.fresh).toBeNull()
  })

  it('a second campaign that ends later lights it once more, and the first never relights', async () => {
    h.rpc.mockResolvedValue({ data: rows(['a', 'First', -5]), error: null })
    let state = await cycle({})
    expect(state.fresh).toMatchObject({ id: 'a' })
    h.rpc.mockResolvedValue({ data: rows(['a', 'First', -5], ['b', 'Second', -1]), error: null })
    state = await cycle(state.seen)
    expect(state.fresh).toMatchObject({ id: 'b', title: 'Second' })
    state = await cycle(state.seen)
    expect(state.fresh).toBeNull()
    expect(announcedCampaigns(state.seen.campaign_ended).sort()).toEqual(['a', 'b'])
  })

  it('two campaigns that end at the same moment are each news once, in a fixed order, whatever order the server returns them in', async () => {
    const at = day(-1)
    const pair = [{ id: 'bbb', status: 'ended', title: 'B', live_at: day(-15), ended_at: at }, { id: 'aaa', status: 'ended', title: 'A', live_at: day(-15), ended_at: at }]
    const now = new Date()
    // The choice does not depend on the order of the rows.
    expect(nextEndedCampaign(pair, undefined, now)).toMatchObject({ id: 'aaa' })
    expect(nextEndedCampaign([...pair].reverse(), undefined, now)).toMatchObject({ id: 'aaa' })

    h.rpc.mockResolvedValue({ data: pair, error: null })
    let state = await cycle({})
    expect(state.fresh).toMatchObject({ id: 'aaa' })
    h.rpc.mockResolvedValue({ data: [...pair].reverse(), error: null })
    state = await cycle(state.seen)
    expect(state.fresh).toMatchObject({ id: 'bbb' })
    // Both seen: no order of the rows relights either.
    for (const order of [pair, [...pair].reverse(), pair]) {
      h.rpc.mockResolvedValue({ data: order, error: null })
      state = await cycle(state.seen)
      expect(state.fresh).toBeNull()
    }
  })

  it('ended by hand or at its end date, it is news all the same; one Hockia had taken down is not', () => {
    const now = new Date()
    // Ended by hand, days before its end date: still news (founder 2026-11-21).
    expect(nextEndedCampaign([{ id: 'hand', status: 'ended', title: 'By hand', live_at: day(-3), ended_at: day(-1) }], undefined, now)).toMatchObject({ id: 'hand' })
    // Taken down, then ended by the hourly job: the note is still on the row.
    const down = { id: 'down', status: 'ended', title: 'Down', live_at: day(-9), ended_at: day(-1), review_note: 'The image is not yours to use.' }
    expect(nextEndedCampaign([down], undefined, now)).toBeNull()
    expect(nextEndedCampaign([down, ...rows(['a', 'First', -2])], undefined, now)).toMatchObject({ id: 'a' })
  })

  it('a signature stored by the first release ("id:ended_at") still counts as seen', () => {
    const now = new Date()
    expect(announcedCampaigns('a:2026-11-20T23:59:59+00:00')).toEqual(['a'])
    expect(nextEndedCampaign(rows(['a', 'First', -2]), `a:${day(-2)}`, now)).toBeNull()
    expect(nextEndedCampaign(rows(['a', 'First', -2], ['b', 'Second', -1]), `a:${day(-2)}`, now)).toMatchObject({ id: 'b' })
  })

  it('a member who is not a brand never triggers the read', async () => {
    h.rpc.mockResolvedValue({ data: [], error: null })
    await loadSuggestions({ id: 'c1', role: 'club' }, {})
    expect(h.rpc).not.toHaveBeenCalledWith('get_my_brand_offers')
  })

  it('stays dark when nothing ended recently, when a draft was deleted, or when the read fails', async () => {
    h.rpc.mockResolvedValue({ data: [{ id: 'old', status: 'ended', title: 'Old', live_at: day(-60), ended_at: day(-40) }, { id: 'never', status: 'ended', title: 'Never live', live_at: null, ended_at: day(-1) }], error: null })
    expect(await loadSuggestions(brand, {})).toEqual([])
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await loadSuggestions(brand, {})).toEqual([])
  })
})
