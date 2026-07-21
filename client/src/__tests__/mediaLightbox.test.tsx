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

// ---------------------------------------------------------------------------
// Video slide tap-to-play — touch-device regression
// ---------------------------------------------------------------------------
// On real touch devices the event order is pointerdown → touchstart →
// pointerup → touchend. useSwipeGesture holds isDragging=true from touchstart
// until touchend, so a tap guard that reads it at pointerup time swallows
// EVERY tap (the "play button does nothing on Android/iOS" bug, silent since
// c689dae). These tests replay that exact order against the real component.
// ---------------------------------------------------------------------------

const videoPost: PostMediaItem[] = [
  {
    url: 'https://example.com/clip.mp4',
    thumb_url: 'https://example.com/poster.jpg',
    media_type: 'video',
    duration: 12.3,
    order: 0,
  },
]

describe('MediaLightbox video slide — tap-to-play on touch devices', () => {
  let playSpy: ReturnType<typeof vi.spyOn>
  let pauseSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // jsdom doesn't implement media playback — spy so togglePlay is observable.
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  afterEach(() => {
    playSpy.mockRestore()
    pauseSpy.mockRestore()
  })

  function renderVideoLightbox() {
    render(<MediaLightbox images={videoPost} initialIndex={0} onClose={vi.fn()} />)
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    // The slide wrapper (owns the pointer handlers) is the video's parent.
    return { video: video as HTMLVideoElement, wrapper: (video as HTMLVideoElement).parentElement as HTMLElement }
  }

  it('plays on tap despite touchstart marking the carousel as dragging (real device event order)', () => {
    const { wrapper } = renderVideoLightbox()

    // Real touch-device order: pointerdown → touchstart → pointerup → touchend.
    fireEvent.pointerDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.touchStart(wrapper, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.pointerUp(wrapper, { clientX: 102, clientY: 101 }) // <10px = tap
    fireEvent.touchEnd(wrapper, { changedTouches: [{ clientX: 102, clientY: 101 }] })

    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT toggle playback when the gesture moved like a swipe', () => {
    const { wrapper } = renderVideoLightbox()

    fireEvent.pointerDown(wrapper, { clientX: 200, clientY: 100 })
    fireEvent.touchStart(wrapper, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.pointerUp(wrapper, { clientX: 80, clientY: 100 }) // 120px horizontal = swipe
    fireEvent.touchEnd(wrapper, { changedTouches: [{ clientX: 80, clientY: 100 }] })

    expect(playSpy).not.toHaveBeenCalled()
  })
})
