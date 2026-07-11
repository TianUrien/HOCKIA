import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FeedTabHint } from '@/components/home/FeedTabHint'

/**
 * The one-time Feed-tab coachmark: shows until any of the three "they got it"
 * signals (✕, bubble tap → Feed, or reaching the Feed tab on their own),
 * then never again — the flag persists in localStorage.
 */

const KEY = 'hockia.feed-tab-hint-seen'

beforeEach(() => {
  // jsdom localStorage persists across tests within a file.
  localStorage.clear()
})

describe('FeedTabHint', () => {
  it('shows on the Pulse tab for a first-time viewer', () => {
    render(<FeedTabHint tab="pulse" onGoToFeed={vi.fn()} />)
    expect(screen.getByText('Looking for posts?')).toBeInTheDocument()
  })

  it('never shows again once seen', () => {
    localStorage.setItem(KEY, '1')
    render(<FeedTabHint tab="pulse" onGoToFeed={vi.fn()} />)
    expect(screen.queryByText('Looking for posts?')).not.toBeInTheDocument()
  })

  it('dismisses and persists via the ✕', () => {
    render(<FeedTabHint tab="pulse" onGoToFeed={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText('Looking for posts?')).not.toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('tapping the bubble jumps to Feed and persists', () => {
    const onGoToFeed = vi.fn()
    render(<FeedTabHint tab="pulse" onGoToFeed={onGoToFeed} />)
    fireEvent.click(screen.getByText('Looking for posts?'))
    expect(onGoToFeed).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('marks itself seen when the user reaches the Feed tab on their own', () => {
    render(<FeedTabHint tab="feed" onGoToFeed={vi.fn()} />)
    expect(screen.queryByText('Looking for posts?')).not.toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBe('1')
  })
})
