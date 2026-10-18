import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/profile', () => ({ invalidateProfile: vi.fn() }))

import { BIO_SHORT, classifyProfileLink, nextStepsFrom, type ProfileFacts } from '@/lib/nextSteps'

const empty: ProfileFacts = { role: 'player', avatar_url: null, bio: null, highlight_video_url: null, social_links: null, position: null, nationality_country_id: null, careerCount: 0, galleryPhotos: [] }

describe('next steps', () => {
  it('a new player: photo, passports, bio, video, clubs, links, position', () => {
    expect(nextStepsFrom(empty).map((s) => s.key)).toEqual(['photo', 'passport', 'bio', 'video', 'career', 'links', 'position'])
  })

  it('coaches get no video or position step', () => {
    expect(nextStepsFrom({ ...empty, role: 'coach' }).map((s) => s.key)).toEqual(['photo', 'bio', 'career', 'links', 'passport'])
  })

  it('offers gallery photos and a short bio improvement', () => {
    const s = nextStepsFrom({ ...empty, galleryPhotos: [{ id: '1', url: 'u' }], bio: 'Defender.' })
    expect(s[0].description).toMatch(/one of your photos/)
    expect(s[2]).toMatchObject({ key: 'bio', label: 'Improve my bio' })
    const long = nextStepsFrom({ ...empty, bio: 'x'.repeat(BIO_SHORT) })
    expect(long.some((x) => x.key === 'bio')).toBe(false)
  })

  it('a complete profile has nothing left', () => {
    expect(nextStepsFrom({ ...empty, avatar_url: 'a', bio: 'b'.repeat(200), highlight_video_url: 'v', social_links: { instagram: 'https://instagram.com/x' }, position: 'defender', nationality_country_id: 1, careerCount: 2 })).toEqual([])
  })

  it('blank social values do not count as links', () => {
    expect(nextStepsFrom({ ...empty, social_links: { instagram: '  ' } }).some((x) => x.key === 'links')).toBe(true)
  })
})

describe('profile links', () => {
  it('videos', () => {
    expect(classifyProfileLink('youtu.be/abc123')).toEqual({ kind: 'video', url: 'https://youtu.be/abc123' })
    expect(classifyProfileLink('https://www.youtube.com/watch?v=abc')).toMatchObject({ kind: 'video' })
    expect(classifyProfileLink('https://vimeo.com/12345/')).toEqual({ kind: 'video', url: 'https://vimeo.com/12345' })
  })
  it('socials need a profile path', () => {
    expect(classifyProfileLink('instagram.com/my.name')).toEqual({ kind: 'social', platform: 'instagram', url: 'https://instagram.com/my.name' })
    expect(classifyProfileLink('https://x.com/me')).toMatchObject({ kind: 'social', platform: 'twitter' })
    expect(classifyProfileLink('https://m.facebook.com/me')).toMatchObject({ kind: 'social', platform: 'facebook' })
    expect(classifyProfileLink('https://instagram.com/')).toEqual({ kind: 'invalid' })
  })
  it('rejects other sites, schemes and junk', () => {
    expect(classifyProfileLink('https://example.com/me')).toEqual({ kind: 'invalid' })
    expect(classifyProfileLink('javascript:alert(1)')).toEqual({ kind: 'invalid' })
    expect(classifyProfileLink('not a link')).toEqual({ kind: 'invalid' })
    expect(classifyProfileLink('')).toEqual({ kind: 'invalid' })
  })
})
