/**
 * ContactModal — the reliable cross-platform "Contact Us" target. Desktop browsers
 * silently ignore `mailto:` without a registered mail handler, so the modal must
 * ALWAYS surface the email + a Copy action (works everywhere) and an Open-mail action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ContactModal from '@/components/ContactModal'
import { useContactModal, SUPPORT_EMAIL } from '@/lib/contact'

const openModal = () => act(() => { useContactModal.getState().open() })

describe('ContactModal', () => {
  beforeEach(() => {
    act(() => { useContactModal.setState({ isOpen: false }) })
  })

  it('renders nothing while closed', () => {
    render(<ContactModal />)
    expect(screen.queryByTestId('contact-modal')).toBeNull()
  })

  it('shows the support email + both actions when opened', () => {
    render(<ContactModal />)
    openModal()
    expect(screen.getByTestId('contact-modal')).toBeTruthy()
    expect(screen.getByTestId('contact-email').textContent).toBe(SUPPORT_EMAIL)
    // Both the always-works copy and the mailto open are present:
    expect(screen.getByRole('button', { name: /copy email address/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /open email app/i })).toBeTruthy()
  })

  it('copies the email to the clipboard (works even where mailto does not)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ContactModal />)
    openModal()
    fireEvent.click(screen.getByRole('button', { name: /copy email address/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SUPPORT_EMAIL))
  })

  it('shows a manual-select hint when copy fails on every path', async () => {
    Object.assign(navigator, { clipboard: undefined })
    document.execCommand = vi.fn().mockReturnValue(false)
    render(<ContactModal />)
    openModal()
    fireEvent.click(screen.getByRole('button', { name: /copy email address/i }))
    await waitFor(() => expect(screen.getByText(/couldn.t copy automatically/i)).toBeTruthy())
  })

  it('closes via the X button', () => {
    render(<ContactModal />)
    openModal()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByTestId('contact-modal')).toBeNull()
  })
})
