import { describe, expect, it } from 'vitest'
import { validateAndNormalizeVideoUrl, validateFullMatchUrl, videoLinkSite } from '@/lib/videoUrlValidator'

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

describe('validateFullMatchUrl', () => {
  it('accepts any https link, e.g. a Hockey TV match page', () => {
    expect(validateFullMatchUrl('https://www.hockeytv.com/watch/12345?x=1')).toBe('https://www.hockeytv.com/watch/12345?x=1')
    expect(validateFullMatchUrl('  https://app.veo.co/matches/abc/  ')).toBe('https://app.veo.co/matches/abc/')
  })
  it('adds https:// when the scheme was left out', () => {
    expect(validateFullMatchUrl('www.hockeytv.com/watch/1')).toBe('https://www.hockeytv.com/watch/1')
  })
  it('keeps the canonical form for YouTube, Vimeo and Drive', () => {
    expect(validateFullMatchUrl('https://youtu.be/abc123?t=42')).toBe('https://www.youtube.com/watch?v=abc123')
    expect(validateFullMatchUrl('https://vimeo.com/123456')).toBe('https://vimeo.com/123456')
  })
  it('accepts YouTube pages the canonical form does not cover (live streams)', () => {
    expect(validateFullMatchUrl('https://www.youtube.com/live/abc123')).toBe('https://www.youtube.com/live/abc123')
  })
  it('refuses anything that is not an https web address', () => {
    for (const bad of ['', 'not a link', 'http://hockeytv.com/watch/1', 'javascript:alert(1)', 'data:text/html,x', 'ftp://site.com/a', 'https://localhost/x', 'https://192.168.1.1/x', 'https://user:pw@site.com/x', 'https://site.com/' + 'a'.repeat(500)]) {
      expect(validateFullMatchUrl(bad)).toBeNull()
    }
  })
})

describe('videoLinkSite', () => {
  it('names the site without www', () => {
    expect(videoLinkSite('https://www.hockeytv.com/watch/1')).toBe('hockeytv.com')
    expect(videoLinkSite('https://www.youtube.com/watch?v=a')).toBe('youtube.com')
    expect(videoLinkSite('nope')).toBeNull()
    expect(videoLinkSite(null)).toBeNull()
  })
})
