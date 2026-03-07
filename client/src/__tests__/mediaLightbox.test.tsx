import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PostMediaItem } from '@/types/homeFeed'

vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

import { MediaLightbox } from '@/components/home/MediaLightbox'

const singleImage: PostMediaItem[] = [
  { url: 'https://example.com/photo1.jpg', order: 0 },
]

const multipleImages: PostMediaItem[] = [
  { url: 'https://example.com/photo1.jpg', order: 0 },
  { url: 'https://example.com/photo2.jpg', order: 1 },
  { url: 'https://example.com/photo3.jpg', order: 2 },
]

describe('MediaLightbox', () => {
  let originalOverflow: string

  beforeEach(() => {
    originalOverflow = document.body.style.overflow
  })

  afterEach(() => {
    document.body.style.overflow = originalOverflow
  })

  it('renders dialog with single image, no arrows, no position indicator', () => {
    render(
      <MediaLightbox
        images={singleImage}
        initialIndex={0}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByAltText('Post media 1')).toBeInTheDocument()
    expect(screen.queryByText(/\//)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Previous')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next')).not.toBeInTheDocument()
  })

  it('renders position indicator for multiple images', () => {
    render(
      <MediaLightbox
        images={multipleImages}
        initialIndex={0}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('navigates to next image on next arrow click', () => {
    render(
      <MediaLightbox
        images={multipleImages}
        initialIndex={0}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByLabelText('Next'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('navigates to previous image on prev arrow click', () => {
    render(
      <MediaLightbox
        images={multipleImages}
        initialIndex={2}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByLabelText('Previous'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('does not navigate past first image', () => {
    render(
      <MediaLightbox
        images={multipleImages}
        initialIndex={0}
        onClose={vi.fn()}
      />
    )

    // No prev button when at first image
    expect(screen.queryByLabelText('Previous')).not.toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('does not navigate past last image', () => {
    render(
      <MediaLightbox
        images={multipleImages}
        initialIndex={2}
        onClose={vi.fn()}
      />
    )

    // No next button when at last image
    expect(screen.queryByLabelText('Next')).not.toBeInTheDocument()
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(
      <MediaLightbox
        images={singleImage}
        initialIndex={0}
        onClose={onClose}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on backdrop click', () => {
    const onClose = vi.fn()
    render(
      <MediaLightbox
        images={singleImage}
        initialIndex={0}
        onClose={onClose}
      />
    )

    // Click the dialog backdrop (outer element)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close on image click', () => {
    const onClose = vi.fn()
    render(
      <MediaLightbox
        images={singleImage}
        initialIndex={0}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByAltText('Post media 1'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('navigates with keyboard arrow keys', () => {
    render(
      <MediaLightbox
        images={multipleImages}
        initialIndex={0}
        onClose={vi.fn()}
      />
    )

    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('locks body scroll when open and restores on unmount', () => {
    const { unmount } = render(
      <MediaLightbox
        images={singleImage}
        initialIndex={0}
        onClose={vi.fn()}
      />
    )

    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe(originalOverflow)
  })
})
