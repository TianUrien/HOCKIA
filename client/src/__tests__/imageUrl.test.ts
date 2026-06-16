import { describe, it, expect } from 'vitest'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'

const OBJ = 'https://proj.supabase.co/storage/v1/object/public'

describe('getImageUrl', () => {
  it('returns the url unchanged for size "original"', () => {
    const url = `${OBJ}/avatars/u/a.jpg`
    expect(getImageUrl(url, 'original')).toBe(url)
  })

  it('returns the url unchanged for non-Supabase urls', () => {
    expect(getImageUrl('https://example.com/a.jpg', 'avatar-md')).toBe('https://example.com/a.jpg')
  })

  it('rewrites to the render path and right-sizes', () => {
    const u = getImageUrl(`${OBJ}/avatars/u/a.jpg`, 'avatar-md')!
    expect(u).toContain('/render/image/public/')
    expect(u).toContain('width=160')
  })

  it('uses webp for jpeg sources (size win)', () => {
    expect(getImageUrl(`${OBJ}/avatars/u/a.jpg`, 'avatar-md')).toContain('format=webp')
  })

  // Regression guard: Supabase webp render flattens PNG alpha onto white, so a
  // PNG source must NOT get format=webp (it stays alpha-preserving PNG).
  it('omits webp for png sources to preserve transparency', () => {
    const u = getImageUrl(`${OBJ}/world-club-logos/c/logo.png`, 'avatar-md')!
    expect(u).not.toContain('format=webp')
    expect(u).toContain('width=160')
  })

  it('returns null for falsy input', () => {
    expect(getImageUrl(null, 'avatar-md')).toBeNull()
    expect(getImageUrl(undefined, 'avatar-md')).toBeNull()
  })
})

describe('getLqipUrl', () => {
  it('returns null for falsy input', () => {
    expect(getLqipUrl(null)).toBeNull()
    expect(getLqipUrl(undefined)).toBeNull()
    expect(getLqipUrl('')).toBeNull()
  })

  it('returns null for a non-Supabase url (caller keeps its own placeholder)', () => {
    expect(getLqipUrl('https://example.com/a.jpg')).toBeNull()
  })

  it('builds a tiny webp render url for a jpeg source', () => {
    const u = getLqipUrl(`${OBJ}/gallery/u/photo.jpg`)!
    expect(u).toContain('/render/image/public/')
    expect(u).toContain('width=24')
    expect(u).toContain('quality=30')
    expect(u).toContain('format=webp')
  })

  it('omits webp for a png source (alpha-safe)', () => {
    const u = getLqipUrl(`${OBJ}/avatars/u/logo.png`)!
    expect(u).toContain('width=24')
    expect(u).not.toContain('format=webp')
  })
})
