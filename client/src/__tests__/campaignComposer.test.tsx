import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), track: vi.fn(), refetch: vi.fn(), order: [] as string[], countryId: 48 as number | null, userId: 'brand-1' as string | null }))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => h.invoke(...a) }, rpc: (...a: unknown[]) => h.rpc(...a) } }))
vi.mock('@tanstack/react-query', async (orig) => ({ ...(await orig<typeof import('@tanstack/react-query')>()), useQueryClient: () => ({ refetchQueries: (...a: unknown[]) => h.refetch(...a) }) }))
vi.mock('@/hooks/useBrandOffers', () => ({ MY_OFFERS: ['brand-offers', 'mine'] }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...a: unknown[]) => h.track(...a) }))
vi.mock('@/hooks/useMyBrand', () => ({ useMyBrand: () => ({ brand: { name: 'Northline', country_id: h.countryId } }) }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => (ids: number[]) => ids.map(() => 'Spain') }))
vi.mock('@/components/hockiaAi/mascot', () => ({ MascotAvatar: () => null }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (pick: (s: { user: { id: string } | null }) => unknown) => pick({ user: h.userId ? { id: h.userId } : null }) }))

import { CampaignComposer } from '@/components/hockiaAi/CampaignComposer'
import { draftAs, draftToFields, keepDraft, keepSentence, keptDraft, keptSentence, type CampaignDraft } from '@/lib/campaignDraft'
import { EMPTY_OFFER, freshWindow } from '@/lib/brandOffers'
import { roleOptionsFor } from '@/lib/hockiaAi'

/**
 * A campaign from one sentence inside Hockia AI (founder 2026-11-21, step C):
 * the brand writes, reviews a draft card, and continues in the editor. Nothing
 * is saved before "Continue in the editor", and that saves a draft only.
 */
const DRAFT: CampaignDraft = { objective: 'ask', title: 'Questions about choosing a stick?', body: 'Write to us about sizes and materials.', need: 'gear', roles: ['player'], place: 'everywhere', perk: null }
const write = (text: string) => fireEvent.change(screen.getByTestId('hockia-ai-campaign-input'), { target: { value: text } })

beforeEach(() => { h.invoke.mockReset(); h.rpc.mockReset(); h.track.mockReset(); h.countryId = 48; h.userId = 'brand-1'; h.order = []; h.refetch.mockReset(); h.refetch.mockImplementation(() => { h.order.push('refetch'); return Promise.resolve() }); keepSentence('brand-1', ''); keepDraft('brand-1', '', null) })

describe('the brand option', () => {
  it('"Write a new campaign for members" is done in the sheet', () => {
    const o = roleOptionsFor({ role: 'brand' })?.find((x) => x.label === 'Write a new campaign for members')
    expect(o?.eyebrow).toBe('DO IT FOR ME')
    expect(o?.action).toEqual({ type: 'campaignDraft' })
  })
})

describe('the draft as the editor reads it', () => {
  const now = new Date('2026-12-01T10:00:00Z')
  it('reaches everyone by default, with a 14-day window and no link, photo or code', () => {
    const f = draftToFields(DRAFT, 48, now)
    expect(f).toMatchObject({ objective: 'ask', title: DRAFT.title, body: DRAFT.body, roles: ['player'], everywhere: true, country_ids: [], image_url: null, link_url: '', promo_code: '', perk: '' })
    expect(f.ends_at).toBe('2026-12-15T23:59:59Z')
  })
  it('"my country" uses the brand\'s own country, and falls back to everyone when the brand has none', () => {
    expect(draftToFields({ ...DRAFT, place: 'my_country' }, 48, now)).toMatchObject({ everywhere: false, country_ids: [48] })
    // The code travels to the editor's own field, and only on an offer.
    expect(draftToFields({ ...DRAFT, objective: 'offer', perk: '20% off', promo_code: 'HOCKIA20' }, 48, now)).toMatchObject({ perk: '20% off', promo_code: 'HOCKIA20' })
    expect(draftToFields({ ...DRAFT, objective: 'product', promo_code: 'HOCKIA20' }, 48, now).promo_code).toBe('')
    expect(draftToFields({ ...DRAFT, place: 'my_country' }, null, now)).toMatchObject({ everywhere: true, country_ids: [] })
  })
  it('a perk travels only with an offer', () => {
    expect(draftToFields({ ...DRAFT, objective: 'offer', perk: '15% off' }, 48, now).perk).toBe('15% off')
    expect(draftToFields({ ...DRAFT, objective: 'product', perk: '15% off' }, 48, now).perk).toBe('')
  })
})

describe('campaign composer', () => {
  it('asks for one sentence and sends nothing until there is one', () => {
    render(<CampaignComposer onGo={vi.fn()} />)
    expect(screen.getByText('Tell me in one sentence what you want members to do, and for whom.')).toBeTruthy()
    expect(screen.getByTestId<HTMLButtonElement>('hockia-ai-campaign-send').disabled).toBe(true)
    write('hi')
    expect(screen.getByTestId<HTMLButtonElement>('hockia-ai-campaign-send').disabled).toBe(true)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('shows the draft as a card; nothing is saved until the brand continues, and then only a draft', async () => {
    h.invoke.mockResolvedValue({ data: { draft: DRAFT, source: 'ai' }, error: null })
    h.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'save_brand_offer' ? 'new-id' : null, error: null }))
    const onGo = vi.fn()
    render(<CampaignComposer onGo={onGo} />)
    write('I want players to write to us with questions about choosing a stick')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByTestId('hockia-ai-campaign-draft-title')).toHaveTextContent('Questions about choosing a stick?')
    expect(h.invoke).toHaveBeenCalledWith('campaign-draft', { body: { text: 'I want players to write to us with questions about choosing a stick' } })
    expect(screen.getByTestId('ai-user-bubble')).toHaveTextContent('I want players to write to us')
    expect(screen.getByTestId('hockia-ai-campaign-draft-for')).toHaveTextContent('Everywhere. Players')
    expect(screen.getByTestId('hockia-ai-campaign-objective-ask').getAttribute('aria-checked')).toBe('true')
    expect(h.rpc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('hockia-ai-campaign-continue'))
    await waitFor(() => expect(onGo).toHaveBeenCalledWith('/dashboard/offers/new-id/edit'))
    const save = h.rpc.mock.calls.find((c) => c[0] === 'save_brand_offer')![1]
    expect(save).toMatchObject({ p_offer_id: null, p_submit: false, p_objective: 'ask', p_title: DRAFT.title, p_everywhere: true, p_link_url: '' })
    expect(h.rpc).toHaveBeenCalledWith('set_brand_offer_need', { p_offer_id: 'new-id', p_need: 'gear' })
    expect(h.track).toHaveBeenCalledWith('hockia_ai_campaign_draft', undefined, undefined, { result: 'draft', objective: 'ask' })
    expect(h.track).toHaveBeenCalledWith('hockia_ai_campaign_draft_continue', 'brand_offer', 'new-id', { objective: 'ask' })
  })

  it('the objective changes with one tap; ambassadors are players, and a perk leaves with the offer', async () => {
    h.invoke.mockResolvedValue({ data: { draft: { ...DRAFT, objective: 'offer', perk: '15% off', roles: ['club'] } }, error: null })
    h.rpc.mockResolvedValue({ data: 'new-id', error: null })
    render(<CampaignComposer onGo={vi.fn()} />)
    write('15% off kits for clubs')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByTestId('hockia-ai-campaign-draft-perk')).toHaveTextContent('15% off')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-objective-ambassador'))
    expect(screen.queryByTestId('hockia-ai-campaign-draft-perk')).toBeNull()
    expect(screen.getByTestId('hockia-ai-campaign-draft-for')).toHaveTextContent('Everywhere. Players')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-continue'))
    await waitFor(() => expect(h.rpc).toHaveBeenCalled())
    expect(h.rpc.mock.calls.find((c) => c[0] === 'save_brand_offer')![1]).toMatchObject({ p_objective: 'ambassador', p_roles: ['player'], p_perk: '' })
  })

  it('"my country" names the brand\'s country', async () => {
    h.invoke.mockResolvedValue({ data: { draft: { ...DRAFT, place: 'my_country' } }, error: null })
    render(<CampaignComposer onGo={vi.fn()} />)
    write('questions from players in my country')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByTestId('hockia-ai-campaign-draft-for')).toHaveTextContent('Spain. Players')
  })

  it('when the daily drafts are used up or the draft fails, it says so and the editor is one tap away', async () => {
    h.invoke.mockResolvedValue({ data: { draft: null, reason: 'limit' }, error: null })
    const onGo = vi.fn()
    const a = render(<CampaignComposer onGo={onGo} />)
    write('sticks for clubs')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByTestId('hockia-ai-campaign-failed')).toHaveTextContent('You have used today’s drafts with Hockia AI.')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-open-editor'))
    expect(onGo).toHaveBeenCalledWith('/dashboard/offers/new')
    a.unmount()

    h.invoke.mockRejectedValue(new Error('network'))
    render(<CampaignComposer onGo={vi.fn()} />)
    write('sticks for clubs')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByTestId('hockia-ai-campaign-failed')).toHaveTextContent('I couldn’t write a draft from that right now.')
    // The sentence is kept for another try.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByTestId<HTMLTextAreaElement>('hockia-ai-campaign-input').value).toBe('sticks for clubs')
  })

  it('a failed save keeps the draft on screen and says so', async () => {
    h.invoke.mockResolvedValue({ data: { draft: DRAFT }, error: null })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const onGo = vi.fn()
    render(<CampaignComposer onGo={onGo} />)
    write('questions about sticks')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    fireEvent.click(await screen.findByTestId('hockia-ai-campaign-continue'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The draft could not be saved.')
    expect(screen.getByTestId('hockia-ai-campaign-draft')).toBeTruthy()
    expect(onGo).not.toHaveBeenCalled()
  })
})

describe('the sentence is never lost', () => {
  const SENTENCE = 'I want players to write to us with questions about choosing a stick'
  it('closing Hockia AI while the draft is being written keeps the sentence for the next time', async () => {
    h.invoke.mockReturnValue(new Promise(() => {}))
    const first = render(<CampaignComposer onGo={vi.fn()} />)
    write(SENTENCE)
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByText('Writing your draft…')).toBeTruthy()
    first.unmount()
    render(<CampaignComposer onGo={vi.fn()} />)
    expect(screen.getByTestId<HTMLTextAreaElement>('hockia-ai-campaign-input').value).toBe(SENTENCE)
  })

  it('it belongs to the member who wrote it, and is cleared once the draft is in the editor', async () => {
    keepSentence('brand-1', SENTENCE)
    expect(keptSentence('brand-2')).toBe('')
    expect(keptSentence(null)).toBe('')
    h.userId = 'brand-2'
    const other = render(<CampaignComposer onGo={vi.fn()} />)
    expect(screen.getByTestId<HTMLTextAreaElement>('hockia-ai-campaign-input').value).toBe('')
    other.unmount()

    h.userId = 'brand-1'
    keepSentence('brand-1', SENTENCE)
    h.invoke.mockResolvedValue({ data: { draft: DRAFT, source: 'ai' }, error: null })
    h.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'save_brand_offer' ? 'new-id' : null, error: null }))
    const onGo = vi.fn()
    render(<CampaignComposer onGo={onGo} />)
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    fireEvent.click(await screen.findByTestId('hockia-ai-campaign-continue'))
    await waitFor(() => expect(onGo).toHaveBeenCalled())
    expect(keptSentence('brand-1')).toBe('')
  })
})

describe('the objective chips', () => {
  it('are 44 px tall at least', async () => {
    h.invoke.mockResolvedValue({ data: { draft: DRAFT, source: 'ai' }, error: null })
    render(<CampaignComposer onGo={vi.fn()} />)
    write('I want players to write to us')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    await screen.findByTestId('hockia-ai-campaign-draft')
    for (const chip of screen.getAllByRole('radio')) expect(chip.className).toContain('min-h-[44px]')
  })
})

describe('a draft opened in the editor days later', () => {
  const saved = { ...EMPTY_OFFER, objective: 'ask' as const, title: 'T', body: 'B', roles: ['player' as const], everywhere: true, ends_at: '2026-12-15T23:59:59Z' }
  it('keeps its end date while that is still 7 to 15 days away', () => {
    expect(freshWindow(saved, false, new Date('2026-12-01T10:00:00Z')).ends_at).toBe('2026-12-15T23:59:59Z')
    expect(freshWindow(saved, false, new Date('2026-12-08T10:00:00Z')).ends_at).toBe('2026-12-15T23:59:59Z')
  })
  it('gets 14 days from today once the saved date is too close or past, so the publish is not refused', () => {
    expect(freshWindow(saved, false, new Date('2026-12-10T10:00:00Z')).ends_at).toBe('2026-12-24T23:59:59Z')
    expect(freshWindow(saved, false, new Date('2027-01-05T10:00:00Z')).ends_at).toBe('2027-01-19T23:59:59Z')
  })
  it('a running campaign keeps its own window, and a campaign with no date or no objective is left alone', () => {
    expect(freshWindow(saved, true, new Date('2026-12-10T10:00:00Z'))).toBe(saved)
    const noDate = { ...saved, ends_at: null }
    expect(freshWindow(noDate, false, new Date('2026-12-10T10:00:00Z'))).toBe(noDate)
  })
})

describe('found before production, 2026-11-22', () => {
  const OFFER: CampaignDraft = { objective: 'offer', title: '15% off kits', body: 'Clubs and coaches get 15% off kits.', need: 'gear', roles: ['club', 'coach'], place: 'everywhere', perk: '15% off', promo_code: 'KIT15' }

  it('the list of campaigns is read again before the editor opens, so the new draft is in it', async () => {
    h.invoke.mockResolvedValue({ data: { draft: DRAFT }, error: null })
    h.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'save_brand_offer' ? 'new-id' : null, error: null }))
    const onGo = vi.fn(() => { h.order.push('go') })
    render(<CampaignComposer onGo={onGo} />)
    write('questions about sticks')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    fireEvent.click(await screen.findByTestId('hockia-ai-campaign-continue'))
    await waitFor(() => expect(onGo).toHaveBeenCalledWith('/dashboard/offers/new-id/edit'))
    expect(h.refetch).toHaveBeenCalledWith({ queryKey: ['brand-offers', 'mine'] })
    expect(h.order).toEqual(['refetch', 'go'])
  })

  it('a list that cannot be read again does not stop the editor from opening', async () => {
    h.invoke.mockResolvedValue({ data: { draft: DRAFT }, error: null })
    h.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'save_brand_offer' ? 'new-id' : null, error: null }))
    h.refetch.mockRejectedValue(new Error('offline'))
    const onGo = vi.fn()
    render(<CampaignComposer onGo={onGo} />)
    write('questions about sticks')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    fireEvent.click(await screen.findByTestId('hockia-ai-campaign-continue'))
    await waitFor(() => expect(onGo).toHaveBeenCalledWith('/dashboard/offers/new-id/edit'))
  })

  it('choosing another objective and coming back restores the perk, the code and who it is for', async () => {
    h.invoke.mockResolvedValue({ data: { draft: OFFER }, error: null })
    h.rpc.mockResolvedValue({ data: 'new-id', error: null })
    render(<CampaignComposer onGo={vi.fn()} />)
    write('15% off kits for clubs and coaches with code KIT15')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByTestId('hockia-ai-campaign-draft-code')).toHaveTextContent('KIT15')
    for (const other of ['ambassador', 'ask', 'product'] as const) {
      fireEvent.click(screen.getByTestId(`hockia-ai-campaign-objective-${other}`))
      // Neither the perk nor the code travels with these objectives, so neither is shown.
      expect(screen.queryByTestId('hockia-ai-campaign-draft-perk')).toBeNull()
      expect(screen.queryByTestId('hockia-ai-campaign-draft-code')).toBeNull()
    }
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-objective-offer'))
    expect(screen.getByTestId('hockia-ai-campaign-draft-perk')).toHaveTextContent('15% off')
    expect(screen.getByTestId('hockia-ai-campaign-draft-code')).toHaveTextContent('KIT15')
    expect(screen.getByTestId('hockia-ai-campaign-draft-for')).toHaveTextContent('Everywhere. Clubs, coaches')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-continue'))
    await waitFor(() => expect(h.rpc).toHaveBeenCalled())
    expect(h.rpc.mock.calls.find((c) => c[0] === 'save_brand_offer')![1]).toMatchObject({ p_objective: 'offer', p_roles: ['club', 'coach'], p_perk: '15% off', p_promo_code: 'KIT15' })
    expect(draftAs(OFFER, 'ambassador')).toMatchObject({ roles: ['player'], perk: null, promo_code: null })
    expect(draftAs(draftAs(OFFER, 'ambassador'), 'offer').roles).toEqual(['player'])
  })

  it('a draft that arrives after Hockia AI was closed is there on return, with the objective last chosen, and no second call is made', async () => {
    let answer: (v: unknown) => void = () => {}
    h.invoke.mockReturnValue(new Promise((res) => { answer = res }))
    const first = render(<CampaignComposer onGo={vi.fn()} />)
    write('15% off kits for clubs and coaches with code KIT15')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-send'))
    expect(await screen.findByText('Writing your draft…')).toBeTruthy()
    first.unmount()
    answer({ data: { draft: OFFER }, error: null })
    await waitFor(() => expect(keptDraft('brand-1', '15% off kits for clubs and coaches with code KIT15')).not.toBeNull())

    const second = render(<CampaignComposer onGo={vi.fn()} />)
    expect(screen.getByTestId('hockia-ai-campaign-draft-title')).toHaveTextContent('15% off kits')
    fireEvent.click(screen.getByTestId('hockia-ai-campaign-objective-product'))
    second.unmount()
    render(<CampaignComposer onGo={vi.fn()} />)
    expect(screen.getByTestId('hockia-ai-campaign-objective-product').getAttribute('aria-checked')).toBe('true')
    expect(h.invoke).toHaveBeenCalledTimes(1)
    // Another member never sees it, and "Write another sentence" lets it go.
    expect(keptDraft('brand-2', '15% off kits for clubs and coaches with code KIT15')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Write another sentence' }))
    expect(keptDraft('brand-1', '15% off kits for clubs and coaches with code KIT15')).toBeNull()
    expect(screen.getByTestId<HTMLTextAreaElement>('hockia-ai-campaign-input').value).toBe('15% off kits for clubs and coaches with code KIT15')
  })

  it('says when the sentence has reached its longest, and not before', () => {
    render(<CampaignComposer onGo={vi.fn()} />)
    write('a'.repeat(499))
    expect(screen.queryByTestId('hockia-ai-campaign-max')).toBeNull()
    write('a'.repeat(620))
    expect(screen.getByTestId<HTMLTextAreaElement>('hockia-ai-campaign-input').value).toHaveLength(500)
    expect(screen.getByTestId('hockia-ai-campaign-max')).toHaveTextContent('That is the longest it can be: 500 characters.')
  })
})
