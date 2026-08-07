/**
 * Resend-verification cooldown — Sentry triage 2026-08-07.
 *
 * Supabase Auth allows one resend per minute, but the button re-enabled
 * after a 5s success flash — a second click surfaced the raw "For security
 * purposes, you can only request this after NN seconds" error (recurring
 * AuthApiError on /verify-email). The button must hold a 60s countdown
 * after a send, and convert a rate-limit error into a countdown instead of
 * showing it raw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const resendVerificationEmail = vi.hoisted(() =>
  vi.fn<(email: string) => Promise<{ success: boolean; error?: string }>>(),
)
vi.mock('@/lib/auth', () => ({ resendVerificationEmail }))

import ResendVerificationButton from '@/components/ResendVerificationButton'

describe('ResendVerificationButton cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resendVerificationEmail.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('holds a 60s countdown after a successful send (no early re-click)', async () => {
    resendVerificationEmail.mockResolvedValue({ success: true })
    render(<ResendVerificationButton email="a@b.com" />)

    fireEvent.click(screen.getByRole('button'))
    await act(async () => { await Promise.resolve() })

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button.textContent).toContain('Resend available in 60s')

    // 10s later: still locked — this is the window that used to re-enable.
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button').textContent).toContain('50s')

    // After the full minute the button is usable again.
    act(() => vi.advanceTimersByTime(50_000))
    expect(screen.getByRole('button')).toBeEnabled()
    expect(resendVerificationEmail).toHaveBeenCalledTimes(1)
  })

  it('converts a rate-limit error into a countdown instead of showing it raw', async () => {
    resendVerificationEmail.mockResolvedValue({
      success: false,
      error: 'For security purposes, you can only request this after 52 seconds.',
    })
    render(<ResendVerificationButton email="a@b.com" />)

    fireEvent.click(screen.getByRole('button'))
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button').textContent).toContain('52s')
    expect(screen.queryByText(/for security purposes/i)).not.toBeInTheDocument()
  })

  it('still shows genuine errors', async () => {
    resendVerificationEmail.mockResolvedValue({ success: false, error: 'Network unreachable' })
    render(<ResendVerificationButton email="a@b.com" />)

    fireEvent.click(screen.getByRole('button'))
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('Network unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeEnabled()
  })
})
