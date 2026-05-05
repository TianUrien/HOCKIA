import { describe, expect, it } from 'vitest'
import { validateAndNormalizeVideoUrl } from '@/lib/videoUrlValidator'

describe('validateAndNormalizeVideoUrl', () => {
  describe('YouTube', () => {
    it('normalises long-form youtube.com/watch?v= URLs', () => {
      expect(validateAndNormalizeVideoUrl('https://www.youtube.com/watch?v=abc123XYZ_-'))
        .toBe('https://www.youtube.com/watch?v=abc123XYZ_-')
    })
    it('normalises youtu.be short links', () => {
      expect(validateAndNormalizeVideoUrl('https://youtu.be/abc123XYZ_-'))
        .toBe('https://www.youtube.com/watch?v=abc123XYZ_-')
    })
    it('strips extra query params from youtu.be links', () => {
      expect(validateAndNormalizeVideoUrl('https://youtu.be/abc123?t=42'))
        .toBe('https://www.youtube.com/watch?v=abc123')
    })
    it('returns null when youtube URL has no video id', () => {
      expect(validateAndNormalizeVideoUrl('https://www.youtube.com/feed/trending'))
        .toBeNull()
    })
  })

  describe('Vimeo', () => {
    it('normalises vimeo.com/<id>', () => {
      expect(validateAndNormalizeVideoUrl('https://vimeo.com/123456789'))
        .toBe('https://vimeo.com/123456789')
    })
    it('strips query params', () => {
      expect(validateAndNormalizeVideoUrl('https://vimeo.com/123456789?autoplay=1'))
        .toBe('https://vimeo.com/123456789')
    })
  })

  describe('Google Drive', () => {
    it('normalises /file/d/<id>/view', () => {
      expect(validateAndNormalizeVideoUrl('https://drive.google.com/file/d/abc123/view?usp=sharing'))
        .toBe('https://drive.google.com/file/d/abc123/view')
    })
    it('normalises ?id=<id> form', () => {
      expect(validateAndNormalizeVideoUrl('https://drive.google.com/open?id=abc123'))
        .toBe('https://drive.google.com/file/d/abc123/view')
    })
  })

  describe('rejection', () => {
    it('returns null for empty string', () => {
      expect(validateAndNormalizeVideoUrl('')).toBeNull()
    })
    it('returns null for whitespace-only', () => {
      expect(validateAndNormalizeVideoUrl('   ')).toBeNull()
    })
    it('returns null for unsupported hosts', () => {
      expect(validateAndNormalizeVideoUrl('https://example.com/video.mp4')).toBeNull()
      expect(validateAndNormalizeVideoUrl('https://twitch.tv/clip/abc')).toBeNull()
      expect(validateAndNormalizeVideoUrl('https://tiktok.com/@user/video/123')).toBeNull()
    })
    it('returns null for plain text input', () => {
      expect(validateAndNormalizeVideoUrl('not a url')).toBeNull()
    })
  })

  it('trims surrounding whitespace before validating', () => {
    expect(validateAndNormalizeVideoUrl('  https://youtu.be/abc123  '))
      .toBe('https://www.youtube.com/watch?v=abc123')
  })
})
