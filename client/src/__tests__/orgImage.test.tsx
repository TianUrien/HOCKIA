import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isFittedOrgImage, orgImageClass, orgImagePaths, orgOriginalUrl } from '@/lib/orgImage'
import { imageKindForRole } from '@/lib/identityImage'
import { OrgLogo } from '@/components/ui/OrgLogo'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import Avatar from '@/components/Avatar'

// CI has no env file: anything that reaches lib/supabase must be mocked.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const BASE = 'https://example.supabase.co/storage/v1/object/public/avatars/owner-1'
const FITTED = `${BASE}/logo_fit_1763600000000.png`
const LEGACY = `${BASE}/brand-logo-1700000000000.jpg`

describe('fitted crest and logo files', () => {
  it('recognises files stored by the crop step, with or without a transform query', () => {
    expect(isFittedOrgImage(FITTED)).toBe(true)
    expect(isFittedOrgImage(`${BASE}/crest_fit_1763600000000.jpg`)).toBe(true)
    expect(isFittedOrgImage(`${FITTED.replace('/object/', '/render/image/')}?width=160&resize=contain`)).toBe(true)
  })

  it('leaves older uploads and other files alone', () => {
    expect(isFittedOrgImage(LEGACY)).toBe(false)
    expect(isFittedOrgImage(`${BASE}/avatar_1700000000000.png`)).toBe(false)
    expect(isFittedOrgImage(`${BASE}/logo_orig_1763600000000.png`)).toBe(false)
    expect(isFittedOrgImage(null)).toBe(false)
    expect(isFittedOrgImage('')).toBe(false)
  })

  it('names the fitted square and the kept original side by side', () => {
    const paths = orgImagePaths('owner-1', 'crest', 42, 'png')
    expect(paths).toEqual({ fitted: 'owner-1/crest_fit_42.png', original: 'owner-1/crest_orig_42.png' })
    expect(isFittedOrgImage(`/${paths.fitted}`)).toBe(true)
  })

  it('finds the original of a fitted URL', () => {
    expect(orgOriginalUrl(FITTED)).toBe(`${BASE}/logo_orig_1763600000000.png`)
    expect(orgOriginalUrl(LEGACY)).toBeNull()
  })

  it('fills the tile for a fitted file and insets an older one', () => {
    expect(orgImageClass(FITTED)).toContain('object-cover')
    expect(orgImageClass(FITTED)).toContain('inset-0')
    expect(orgImageClass(LEGACY)).toContain('object-contain')
    expect(orgImageClass(LEGACY)).toContain('rounded-[18%]')
  })

  it('maps roles to the kind of image they upload', () => {
    expect(imageKindForRole('club')).toBe('crest')
    expect(imageKindForRole('brand')).toBe('logo')
    expect(imageKindForRole('player')).toBe('person')
    expect(imageKindForRole(null)).toBe('person')
  })
})

describe('one shape per kind of image', () => {
  it('OrgLogo is a white rounded square that the fitted logo fills', () => {
    const { container } = render(<OrgLogo src={FITTED} alt="Brand" className="h-10 w-10" />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile.className).toContain('rounded-[25%]')
    expect(tile.className).toContain('bg-white')
    expect(tile.className).toContain('overflow-hidden')
    expect(screen.getByAltText('Brand').className).toContain('object-cover')
  })

  it('OrgLogo keeps an older upload whole inside the tile', () => {
    render(<OrgLogo src={LEGACY} alt="Brand" />)
    expect(screen.getByAltText('Brand').className).toContain('object-contain')
  })

  it('OrgLogo does not fight a caller that positions it', () => {
    const { container } = render(<OrgLogo src={FITTED} className="absolute left-0 top-0 h-10 w-10" />)
    expect((container.firstElementChild as HTMLElement).className.split(' ')).not.toContain('relative')
  })

  it('EntityAvatar shows a club crest and a brand logo in the organisation tile', () => {
    const { container, rerender } = render(<EntityAvatar src={FITTED} name="Club" role="club" size={48} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('rounded-[25%]')
    rerender(<EntityAvatar src={LEGACY} name="Brand" role="brand" size={48} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('rounded-[25%]')
  })

  it('Avatar draws a club or brand image as a rounded square, never a circle', () => {
    const { container, rerender } = render(<Avatar src={FITTED} alt="Club" role="club" />)
    const box = () => container.firstElementChild as HTMLElement
    expect(box().className).toContain('rounded-[25%]')
    expect(box().className).not.toContain('rounded-full')
    rerender(<Avatar src={LEGACY} alt="Brand" role="brand" />)
    expect(box().className).toContain('rounded-[25%]')
    expect(screen.getByAltText('Brand').className).toContain('object-contain')
  })

  it('Avatar keeps people in a circle with the photo covering it', () => {
    const { container } = render(<Avatar src={`${BASE}/avatar_1.jpg`} alt="Player" role="player" />)
    expect((container.firstElementChild as HTMLElement).className).toContain('rounded-full')
    expect(screen.getByAltText('Player').className).toContain('object-cover')
  })
})
