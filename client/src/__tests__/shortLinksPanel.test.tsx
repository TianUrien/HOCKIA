import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({ list: vi.fn(), upsert: vi.fn() }))
vi.mock('@/features/admin/api/shortLinksApi', () => ({ listShortLinks: m.list, upsertShortLink: m.upsert }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

import { ShortLinksPanel } from '@/features/admin/components/ShortLinksPanel'

const row = {
  code: 'ig', label: 'Instagram bio', destination: '/', utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'bio',
  utm_content: null, utm_term: null, is_active: true, click_count: 42, last_clicked_at: null, created_at: '2026-08-28T00:00:00Z',
  clicks_30d: 7, signups: 3, normalized_source: 'instagram',
}

describe('ShortLinksPanel', () => {
  beforeEach(() => { m.list.mockReset(); m.upsert.mockReset(); m.list.mockResolvedValue([row]) })

  it('lists links with channel, clicks and attributed signups', async () => {
    render(<ShortLinksPanel />)
    await waitFor(() => expect(screen.getByTestId('short-link-row-ig')).toBeInTheDocument())
    const r = screen.getByTestId('short-link-row-ig')
    expect(r).toHaveTextContent('Instagram bio')
    expect(r).toHaveTextContent('/l/ig')
    expect(r).toHaveTextContent('Instagram · bio')
    expect(r).toHaveTextContent('42')
    expect(r).toHaveTextContent('7')
    expect(r).toHaveTextContent('3')
  })

  it('mints a link: suggests the code from the label, previews the channel, saves normalized input', async () => {
    m.upsert.mockResolvedValue(undefined)
    render(<ShortLinksPanel />)
    await waitFor(() => expect(screen.getByTestId('short-link-new')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('short-link-new'))
    fireEvent.change(screen.getByPlaceholderText('Instagram bio'), { target: { value: 'LinkedIn Post' } })
    expect((screen.getByPlaceholderText('ig') as HTMLInputElement).value).toBe('linkedin-post')
    fireEvent.change(screen.getByPlaceholderText('instagram'), { target: { value: 'LinkedIn' } })
    expect(screen.getByTestId('short-link-channel')).toHaveTextContent('Reports as LinkedIn · Social')
    fireEvent.change(screen.getByPlaceholderText('social'), { target: { value: 'social' } })
    fireEvent.click(screen.getByTestId('short-link-save'))
    await waitFor(() => expect(m.upsert).toHaveBeenCalledTimes(1))
    expect(m.upsert.mock.calls[0][0]).toMatchObject({ code: 'linkedin-post', label: 'LinkedIn Post', destination: '/', utm_source: 'linkedin', utm_medium: 'social', utm_campaign: null })
  })

  it('warns when utm_source is not a known channel and blocks unsafe destinations', async () => {
    render(<ShortLinksPanel />)
    await waitFor(() => expect(screen.getByTestId('short-link-new')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('short-link-new'))
    fireEvent.change(screen.getByPlaceholderText('Instagram bio'), { target: { value: 'Test' } })
    fireEvent.change(screen.getByPlaceholderText('instagram'), { target: { value: 'instagrm' } })
    expect(screen.getByTestId('short-link-channel')).toHaveTextContent('Not a known channel')
    fireEvent.change(screen.getByPlaceholderText(/opportunities/), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByTestId('short-link-save'))
    await waitFor(() => expect(screen.getByTestId('short-link-form-error')).toHaveTextContent('Destination must be'))
    expect(m.upsert).not.toHaveBeenCalled()
  })

  it('refuses a code that already exists', async () => {
    render(<ShortLinksPanel />)
    await waitFor(() => expect(screen.getByTestId('short-link-new')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('short-link-new'))
    fireEvent.change(screen.getByPlaceholderText('Instagram bio'), { target: { value: 'Dup' } })
    fireEvent.change(screen.getByPlaceholderText('ig'), { target: { value: 'ig' } })
    fireEvent.change(screen.getByPlaceholderText('instagram'), { target: { value: 'instagram' } })
    fireEvent.click(screen.getByTestId('short-link-save'))
    await waitFor(() => expect(screen.getByTestId('short-link-form-error')).toHaveTextContent('already taken'))
  })

  it('retires a link with the toggle (upsert with is_active false)', async () => {
    m.upsert.mockResolvedValue(undefined)
    render(<ShortLinksPanel />)
    await waitFor(() => expect(screen.getByRole('switch')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ code: 'ig', is_active: false })))
  })
})
