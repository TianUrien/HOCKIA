Deno.env.set('PUBLIC_SITE_URL', 'https://staging.inhockia.com')
import { assert, assertFalse, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { EMAIL_LOGO_HTML, emailAvatarHtml, placeholderAvatarUrl } from './email-brand.ts'

Deno.test('email logo: the ink lockup from the site the email belongs to (2026-10-30)', () => {
  assertStringIncludes(EMAIL_LOGO_HTML, 'src="https://staging.inhockia.com/brand/email/hockia-lockup-ink-84h.png"')
  assertStringIncludes(EMAIL_LOGO_HTML, 'alt="HOCKIA"')
  assertFalse(EMAIL_LOGO_HTML.includes('wordmark'))
})

Deno.test('email avatar: photo when https, else the role placeholder, never initials', () => {
  assertStringIncludes(emailAvatarHtml('https://cdn.test/a.png', 'Ana Paz', 'player'), 'src="https://cdn.test/a.png"')
  for (const role of ['player', 'coach', 'umpire', 'club', 'brand']) {
    assertStringIncludes(emailAvatarHtml(null, 'Ana Paz', role), `placeholder-${role}-144.png`)
  }
  assertStringIncludes(placeholderAvatarUrl(null), 'placeholder-player-144.png')
  const html = emailAvatarHtml('javascript:alert(1)', 'Ana <b>Paz</b>', 'club', 40)
  assertFalse(html.includes('javascript:'))
  assertFalse(html.includes('>AP<'))
  assert(html.includes('alt="Ana &lt;b&gt;Paz&lt;/b&gt;"'))
  assert(html.includes('width="40"'))
})
