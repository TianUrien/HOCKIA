import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MascotClip } from '@/components/hockiaAi/mascot'

vi.mock('@/lib/spring', () => ({ prefersReducedMotion: vi.fn(() => false) }))
import { prefersReducedMotion } from '@/lib/spring'

describe('MascotClip', () => {
  beforeEach(() => {
    vi.mocked(prefersReducedMotion).mockReturnValue(false)
    HTMLMediaElement.prototype.load = vi.fn()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  })

  it('plays the clip when it can', () => {
    render(<MascotClip clip="wave" height={96} />)
    expect(screen.getByTestId('mascot-clip-wave')).toBeInTheDocument()
    expect(screen.queryByTestId('mascot-still-wave')).not.toBeInTheDocument()
  })

  it('shows the poster when the video cannot be decoded', () => {
    render(<MascotClip clip="wave" height={96} />)
    fireEvent.error(screen.getByTestId('mascot-clip-wave'))
    const still = screen.getByTestId('mascot-still-wave')
    expect(still).toHaveAttribute('src', '/hockia-ai/wave_poster.webp')
    expect(screen.queryByTestId('mascot-clip-wave')).not.toBeInTheDocument()
  })

  it('shows the poster when no source can be loaded', () => {
    render(<MascotClip clip="idle" height={96} />)
    const sources = screen.getByTestId('mascot-clip-idle').querySelectorAll('source')
    fireEvent.error(sources[sources.length - 1])
    expect(screen.getByTestId('mascot-still-idle')).toBeInTheDocument()
  })

  it('shows the poster with Reduce Motion', () => {
    vi.mocked(prefersReducedMotion).mockReturnValue(true)
    render(<MascotClip clip="wave" height={96} />)
    expect(screen.getByTestId('mascot-still-wave')).toBeInTheDocument()
  })
})
