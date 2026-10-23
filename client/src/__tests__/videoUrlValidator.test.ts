import { describe, expect, it } from 'vitest'
import { safeVideoHref, validateAndNormalizeVideoUrl, validateFullMatchUrl, videoEmbedUrl, videoLinkSite, videoPlatformLabel } from '@/lib/videoUrlValidator'

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

// CodeQL 2026-10-23: hosts are matched on the parsed address, never as text,
// and a stored link only reaches an href or iframe when it is safe.

describe('video links are parsed, not substring-matched', () => {
  it('rejects lookalike hosts and other schemes', () => {
    for (const bad of [
      'https://evil.com/?youtube.com&v=abc',
      'https://youtube.com.evil.com/watch?v=abc',
      'https://notyoutube.com/watch?v=abc',
      'javascript:alert(1)//youtube.com?v=abc',
      'data:text/html,<script>youtube.com</script>',
      'https://evil.com/vimeo.com/123',
      'https://drive.google.com.evil.com/file/d/abc/view',
      'https://www.youtube.com/watch?v=abc"onload="x',
    ]) {
      expect(validateAndNormalizeVideoUrl(bad), bad).toBeNull()
      expect(videoEmbedUrl(bad), bad).toBeNull()
    }
  })
  it('still accepts real links, subdomains and links typed without https://', () => {
    expect(validateAndNormalizeVideoUrl('https://m.youtube.com/watch?v=abc123')).toBe('https://www.youtube.com/watch?v=abc123')
    expect(validateAndNormalizeVideoUrl('youtu.be/abc123')).toBe('https://www.youtube.com/watch?v=abc123')
    expect(validateAndNormalizeVideoUrl('https://www.youtube.com/shorts/abc123')).toBe('https://www.youtube.com/watch?v=abc123')
    expect(validateAndNormalizeVideoUrl('https://player.vimeo.com/video/123456')).toBe('https://vimeo.com/123456')
  })
  it('embeds only the provider players', () => {
    expect(videoEmbedUrl('https://youtu.be/abc123')).toBe('https://www.youtube-nocookie.com/embed/abc123?rel=0&playsinline=1')
    expect(videoEmbedUrl('https://vimeo.com/123456')).toBe('https://player.vimeo.com/video/123456')
    expect(videoEmbedUrl('https://drive.google.com/open?id=abc123')).toBe('https://drive.google.com/file/d/abc123/preview')
    expect(videoEmbedUrl('https://www.hockeytv.com/watch/1')).toBeNull()
    expect(videoPlatformLabel('https://vimeo.com/123456')).toBe('Vimeo')
    expect(videoPlatformLabel('https://example.com/x')).toBeNull()
  })
  it('safeVideoHref opens https links only', () => {
    expect(safeVideoHref('https://www.hockeytv.com/watch/1')).toBe('https://www.hockeytv.com/watch/1')
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'http://site.com/x', 'vbscript:x', 'https://u:p@site.com/x', 'not a url', '', null, undefined]) {
      expect(safeVideoHref(bad as string | null | undefined), String(bad)).toBeNull()
    }
  })
})
