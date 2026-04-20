import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FreshnessCard from '@/components/FreshnessCard'
import type { FreshnessNudge } from '@/lib/profileFreshness'

const sampleNudge: FreshnessNudge = {
  id: 'journey-stale',
  message: 'Your last Journey update was 5 weeks ago.',
  ctaLabel: 'Update Journey',
  action: { type: 'tab', tab: 'journey' },
  daysSince: 35,
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FreshnessCard', () => {
  it('renders nothing when nudge is null', () => {
    const { container } = render(<FreshnessCard nudge={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the nudge message and CTA when a nudge is passed', () => {
    render(<FreshnessCard nudge={sampleNudge} />)
    expect(screen.getByText(sampleNudge.message)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /update journey/i })).toBeInTheDocument()
  })

  it('fires onAction with the nudge when the CTA is clicked', () => {
    const onAction = vi.fn()
    render(<FreshnessCard nudge={sampleNudge} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: /update journey/i }))
    expect(onAction).toHaveBeenCalledWith(sampleNudge)
  })

  it('hides the card after the dismiss button is clicked', () => {
    render(<FreshnessCard nudge={sampleNudge} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss this nudge/i }))
    expect(screen.queryByText(sampleNudge.message)).not.toBeInTheDocument()
  })

  it('persists dismissal so a fresh mount stays hidden within the 7-day cooldown', () => {
    const { unmount } = render(<FreshnessCard nudge={sampleNudge} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss this nudge/i }))
    unmount()

    render(<FreshnessCard nudge={sampleNudge} />)
    expect(screen.queryByText(sampleNudge.message)).not.toBeInTheDocument()
  })

  it('re-shows the nudge after the 7-day cooldown window expires', () => {
    // Pre-seed a stale dismissal from 8 days ago.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    window.localStorage.setItem('hockia-freshness-dismiss:journey-stale', eightDaysAgo)

    render(<FreshnessCard nudge={sampleNudge} />)
    expect(screen.getByText(sampleNudge.message)).toBeInTheDocument()
  })

  it('treats a malformed dismissal timestamp as "not dismissed"', () => {
    window.localStorage.setItem('hockia-freshness-dismiss:journey-stale', 'nonsense')
    render(<FreshnessCard nudge={sampleNudge} />)
    expect(screen.getByText(sampleNudge.message)).toBeInTheDocument()
  })

  it('scopes dismissal by nudge id — dismissing one does not hide a different nudge', () => {
    const otherNudge: FreshnessNudge = {
      ...sampleNudge,
      id: 'gallery-stale',
      message: 'Gallery nudge',
      ctaLabel: 'Add to Gallery',
    }
    const { rerender } = render(<FreshnessCard nudge={sampleNudge} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss this nudge/i }))

    rerender(<FreshnessCard nudge={otherNudge} />)
    expect(screen.getByText('Gallery nudge')).toBeInTheDocument()
  })
})
