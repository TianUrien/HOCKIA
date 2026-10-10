/**
 * Instagram-style carousel dots in the photo viewer: they show there is more
 * to swipe, at most 5 at a time, following the current photo.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { dotWindow } from '@/lib/carouselDots'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import { MediaLightbox } from '@/components/home/MediaLightbox'

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://example.com/p${i}.jpg`, media_type: 'image' as const, order: i }))

describe('dotWindow', () => {
  it('shows every dot up to 5', () => {
    expect(dotWindow(3, 1)).toEqual({ start: 0, end: 3 })
    expect(dotWindow(5, 4)).toEqual({ start: 0, end: 5 })
  })
  it('keeps a 5-dot window around the current photo, clamped at both ends', () => {
    expect(dotWindow(19, 0)).toEqual({ start: 0, end: 5 })
    expect(dotWindow(19, 9)).toEqual({ start: 7, end: 12 })
    expect(dotWindow(19, 18)).toEqual({ start: 14, end: 19 })
  })
})

describe('MediaLightbox dots', () => {
  const open = (n: number, initialIndex = 0) =>
    render(
      <MemoryRouter>
        <MediaLightbox images={photos(n)} initialIndex={initialIndex} onClose={vi.fn()} />
      </MemoryRouter>,
    )
  const dots = () => Array.from(screen.getByTestId('carousel-dots').children)
  const activeIndex = () => dots().findIndex((d) => d.hasAttribute('data-active'))

  it('no dots for a single photo', () => {
    open(1)
    expect(screen.queryByTestId('carousel-dots')).toBeNull()
  })

  it('one dot per photo when there are few, and the active one moves on swipe/arrow', () => {
    open(3)
    expect(dots()).toHaveLength(3)
    expect(activeIndex()).toBe(0)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(activeIndex()).toBe(1)
  })

  it('at most 5 dots for 19 photos; outer dots shrink when more lie beyond', () => {
    open(19, 9)
    expect(dots()).toHaveLength(5)
    expect(activeIndex()).toBe(2)
    expect(dots()[0].className).toMatch(/\bh-1\b/)
    expect(dots()[4].className).toMatch(/\bh-1\b/)
    expect(dots()[2].className).toMatch(/h-1\.5/)
  })

  it('is decorative: the "N of M" counter stays the accessible position', () => {
    open(19)
    expect(screen.getByTestId('carousel-dots')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('1 of 19')).toBeInTheDocument()
  })
})
