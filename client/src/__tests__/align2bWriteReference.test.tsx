/**
 * Write a reference (Figma 152:962): gender-neutral copy (the first name,
 * never a pronoun), the relationship as a Chip, a text area, Primary "Send
 * reference".
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    functions: { invoke: vi.fn() },
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
  SUPABASE_URL: 'https://test.supabase.local',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))

import WriteReferenceSheet from '@/components/profile/mobile/WriteReferenceSheet'

const renderSheet = (over: Partial<Parameters<typeof WriteReferenceSheet>[0]> = {}) => {
  const onSend = vi.fn(async () => true)
  render(<WriteReferenceSheet open onClose={vi.fn()} forName="Valentina" relationshipType="club_manager" loading={false} onSend={onSend} {...over} />)
  return { onSend }
}

describe('WriteReferenceSheet', () => {
  it('asks "How do you know <first name>?" and prompts with the first name', () => {
    renderSheet()
    expect(screen.getByTestId('write-reference-question').textContent).toBe('How do you know Valentina?')
    expect(screen.getByLabelText('Your reference').getAttribute('placeholder')).toBe('What did Valentina bring to the team? Be specific — clubs read these.')
  })

  it('never uses a gendered pronoun', () => {
    renderSheet({ requestNote: 'Thanks!' })
    const dialog = screen.getByRole('dialog')
    const text = `${dialog.textContent ?? ''} ${screen.getByLabelText('Your reference').getAttribute('placeholder') ?? ''}`
    expect(text).not.toMatch(/\b(he|she|him|her|his|hers)\b/i)
  })

  it('falls back to neutral words without a name', () => {
    renderSheet({ forName: null })
    expect(screen.getByTestId('write-reference-question').textContent).toBe('How do you know this member?')
  })

  it('the relationship is a selected Chip (soft purple), not editable', () => {
    renderSheet()
    const chip = screen.getByTestId('write-reference-relationship')
    expect(chip.textContent).toBe('Club manager')
    expect(chip.className).toContain('bg-brand-soft')
    expect(chip.getAttribute('aria-disabled')).toBe('true')
    expect(chip.parentElement?.className).toContain('flex-wrap')
  })

  it('Primary "Send reference" sends the trimmed text; too short is refused', async () => {
    const { onSend } = renderSheet()
    const send = screen.getByTestId('write-reference-send')
    expect(send.textContent).toBe('Send reference')
    expect(send.className).toContain('bg-hockia-primary')
    fireEvent.click(send)
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Your reference'), { target: { value: '  Leads by example and lifts the whole team.  ' } })
    fireEvent.click(send)
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Leads by example and lifts the whole team.'))
  })
})
