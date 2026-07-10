import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { PostMediaUploader } from '@/components/home/PostMediaUploader'

// The composer preview mints a signed thumbnail for ready Cloudflare videos
// (the hook has its own tests via the Gallery suite). Deterministic stub here.
vi.mock('@/hooks/useSignedVideoThumbnail', () => ({
  useSignedVideoThumbnail: (videoId: string | null | undefined) => ({
    thumb: videoId ? `https://videodelivery.net/tok-${videoId}/thumbnails/thumbnail.jpg` : null,
    onThumbError: vi.fn(),
    onThumbLoad: vi.fn(),
  }),
}))

/**
 * Video attachment is a REGULAR-POST feature. In transfer/signing composer
 * mode the announcement cards cannot play video and the RPCs reject Cloudflare
 * video items — so the composer passes allowVideo={false} and the button must
 * not exist. This guards the prop's behavior (the dead-tile fix at source).
 */

const baseProps = {
  media: [],
  onAddImage: vi.fn(),
  onAddVideo: vi.fn(),
  onRemove: vi.fn(),
  isUploading: false,
}

describe('PostMediaUploader video gate', () => {
  it('shows the video button by default (regular post)', () => {
    render(<PostMediaUploader {...baseProps} />)
    expect(screen.getByText('Add video')).toBeInTheDocument()
  })

  it('shows the signed poster frame for a ready Cloudflare video in the preview', () => {
    const { container } = render(
      <PostMediaUploader
        {...baseProps}
        media={[{ video_id: 'v-9', media_type: 'video', duration: 12.4, order: 0 }]}
      />,
    )
    // The generated frame replaces the generic dark tile...
    const img = container.querySelector('img[src="https://videodelivery.net/tok-v-9/thumbnails/thumbnail.jpg"]')
    expect(img).not.toBeNull()
    // ...with the duration badge intact (floored).
    expect(screen.getByText('0:12')).toBeInTheDocument()
  })

  it('keeps the stored thumb_url for legacy video items (no signed mint)', () => {
    const { container } = render(
      <PostMediaUploader
        {...baseProps}
        media={[{ url: 'https://x/legacy.mp4', thumb_url: 'https://x/legacy-thumb.jpg', media_type: 'video', duration: 30, order: 0 }]}
      />,
    )
    expect(container.querySelector('img[src="https://x/legacy-thumb.jpg"]')).not.toBeNull()
  })

  it('removes the video path entirely when allowVideo is false (announcements / flag off)', () => {
    render(<PostMediaUploader {...baseProps} allowVideo={false} />)
    expect(screen.queryByText('Add video')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Select video file')).not.toBeInTheDocument()
    // Photos remain available.
    expect(screen.getByText('Add photos')).toBeInTheDocument()
  })
})
