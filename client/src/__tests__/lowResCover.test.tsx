/**
 * Batch C (2026-10-21): covers narrower than 600 px fall back to the
 * crest-gradient cover; a club without a crest gets the violet initials tile.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MIN_COVER_WIDTH, isLowResCover } from '@/lib/coverQuality'
import { CrestTile, RoleCover } from '@/components/opportunities/RoleCover'

describe('isLowResCover', () => {
  it('flags only measured widths under 600', () => {
    expect(MIN_COVER_WIDTH).toBe(600)
    expect(isLowResCover(599)).toBe(true)
    expect(isLowResCover(600)).toBe(false)
    expect(isLowResCover(0)).toBe(false)
    expect(isLowResCover(null)).toBe(false)
  })
})

describe('RoleCover', () => {
  const loadWith = (img: HTMLImageElement, width: number) => {
    Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
    fireEvent.load(img)
  }

  it('keeps a photo that is wide enough', () => {
    const { container } = render(<RoleCover coverUrl="https://x.test/big.jpg" palette={null} />)
    loadWith(container.querySelector('img') as HTMLImageElement, 1200)
    expect(screen.getByTestId('role-cover').getAttribute('data-cover')).toBe('photo')
  })

  it('falls back to the generated cover for a photo under 600 px', () => {
    const { container } = render(<RoleCover coverUrl="https://x.test/small.jpg" crestUrl="https://x.test/crest.png" palette={null} />)
    loadWith(container.querySelector('img') as HTMLImageElement, 320)
    expect(screen.getByTestId('role-cover').getAttribute('data-cover')).not.toBe('photo')
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('CrestTile without a crest', () => {
  it('is the violet club treatment with letters-only initials, not grey initials', () => {
    render(<CrestTile src={null} name="[QA] Club Test" size={48} radius={14} />)
    expect(screen.getByTestId('role-placeholder').getAttribute('data-role')).toBe('club')
    expect(screen.getByTestId('role-placeholder-initials').textContent).toBe('CT')
  })
})
