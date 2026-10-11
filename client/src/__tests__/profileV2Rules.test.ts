import { describe, expect, it } from 'vitest'
import { instagramHandle, nextStepPart, sameBrandName, sponsorLabel } from '@/lib/profileV2'

describe('next step (ruling 11 Oct)', () => {
  it('starts with the photo while it is missing, whatever the weights', () => {
    const parts = [
      { key: 'video', weight: 20, done: false },
      { key: 'photo', weight: 10, done: false },
    ]
    expect(nextStepPart(parts)?.key).toBe('photo')
  })
  it('then takes the highest-weight missing part', () => {
    const parts = [
      { key: 'photo', weight: 10, done: true },
      { key: 'bio', weight: 5, done: false },
      { key: 'video', weight: 20, done: false },
      { key: 'references', weight: 10, done: false },
    ]
    expect(nextStepPart(parts)?.key).toBe('video')
  })
  it('crest and logo count as the first step for clubs and brands', () => {
    expect(nextStepPart([{ key: 'bio', weight: 20, done: false }, { key: 'crest', weight: 15, done: false }])?.key).toBe('crest')
    expect(nextStepPart([{ key: 'bio', weight: 20, done: false }, { key: 'logo', weight: 20, done: false }])?.key).toBe('logo')
  })
  it('never suggests a bonus part, and nothing when complete', () => {
    expect(nextStepPart([{ key: 'photo', weight: 10, done: true }, { key: 'work_permit', weight: 5, done: false, bonus: true }])).toBeNull()
    expect(nextStepPart([])).toBeNull()
  })
})

describe('instagram handle', () => {
  it('reads URLs and bare handles', () => {
    expect(instagramHandle({ instagram: 'https://www.instagram.com/valentur/' })).toBe('valentur')
    expect(instagramHandle({ instagram: '@valen.tur' })).toBe('valen.tur')
    expect(instagramHandle({ instagram: '' })).toBeNull()
    expect(instagramHandle(null)).toBeNull()
  })
})

describe('sponsor match', () => {
  it('is case- and space-insensitive', () => {
    expect(sameBrandName('Grays', ' grays ')).toBe(true)
    expect(sameBrandName('Grays Hockey', 'graysHOCKEY')).toBe(true)
    expect(sameBrandName('Grays', 'Gryphon')).toBe(false)
    expect(sameBrandName('', '')).toBe(false)
  })
})

describe('self-declared sponsor label', () => {
  it('never doubles player / athlete', () => {
    expect(sponsorLabel('Grays Player')).toBe('Grays Player')
    expect(sponsorLabel('Adidas athlete')).toBe('Adidas athlete')
    expect(sponsorLabel('Osaka')).toBe('Osaka player')
    expect(sponsorLabel('Playerz')).toBe('Playerz player')
  })
})
