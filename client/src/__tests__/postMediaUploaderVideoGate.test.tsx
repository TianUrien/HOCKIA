import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { PostMediaUploader } from '@/components/home/PostMediaUploader'

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

  it('removes the video path entirely when allowVideo is false (announcements / flag off)', () => {
    render(<PostMediaUploader {...baseProps} allowVideo={false} />)
    expect(screen.queryByText('Add video')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Select video file')).not.toBeInTheDocument()
    // Photos remain available.
    expect(screen.getByText('Add photos')).toBeInTheDocument()
  })
})
