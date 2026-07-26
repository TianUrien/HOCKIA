import { describe, expect, it } from 'vitest'
import { safeRedirectPath, isSafeRedirectPath } from '@/lib/safeRedirect'

// Security regression suite. The post-auth redirect target comes from the
// untrusted `?next=` param and location.state.from, and is fed to navigate().
// A `startsWith('/')` check (what we shipped before) is bypassable — these
// cases must all be rejected.

const FALLBACK = '/dashboard/profile'

describe('safeRedirectPath — rejects open-redirect vectors', () => {
  const attacks = [
    ['absolute http', 'http://evil.com'],
    ['absolute https', 'https://evil.com'],
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/steal'],
    ['backslash pair (CVE bypass class)', '/\\evil.com'],
    ['backslash escape', '\\\\evil.com'],
    ['mixed separators', '/\\/evil.com'],
    ['backslash anywhere', '/dashboard\\@evil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['scheme before slash', 'mailto:a@b.com'],
    ['tab smuggling', '/\t//evil.com'],
    ['newline smuggling', '/\n//evil.com'],
    ['leading space', ' //evil.com'],
    ['relative (no leading slash)', 'dashboard'],
    ['empty', ''],
  ] as const

  it.each(attacks)('rejects %s', (_label, payload) => {
    expect(safeRedirectPath(payload, FALLBACK)).toBe(FALLBACK)
    expect(isSafeRedirectPath(payload)).toBe(false)
  })

  it('rejects null/undefined', () => {
    expect(safeRedirectPath(null, FALLBACK)).toBe(FALLBACK)
    expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK)
  })
})

describe('safeRedirectPath — allows legitimate in-app targets', () => {
  const allowed = [
    '/dashboard/profile',
    '/opportunities',
    '/opportunities/123e4567-e89b-12d3-a456-426614174000',
    '/players/id/912cb202-5f80-4cc7-aa6b-2f0e51287d2b',
    '/clubs/id/abc/media',
    '/community?tab=players',
    '/world/au',
    '/invite/club/token-123',
    '/messages#thread',
  ]

  it.each(allowed)('allows %s', (path) => {
    expect(safeRedirectPath(path, FALLBACK)).toBe(path)
    expect(isSafeRedirectPath(path)).toBe(true)
  })
})

describe('safeRedirectPath — never bounces back to the landing page', () => {
  // QA 2026-07-25: '/' is same-origin and passed every other check, but the
  // landing page itself redirects authenticated users — so a stored redirect
  // of '/' sent them back to the page that immediately re-ran the same effect.
  it('rejects "/" (would re-trigger the landing redirect effect)', () => {
    expect(safeRedirectPath('/', FALLBACK)).toBe(FALLBACK)
    expect(isSafeRedirectPath('/')).toBe(false)
  })

  it('still allows real paths that merely start with a slash', () => {
    expect(safeRedirectPath('/home', FALLBACK)).toBe('/home')
  })
})

describe('safeRedirectPath — never bounces back into auth screens', () => {
  it.each(['/signin', '/signup', '/auth/callback', '/signin/', '/signup?next=/x'])(
    'rejects %s (would loop)',
    (path) => {
      expect(safeRedirectPath(path, FALLBACK)).toBe(FALLBACK)
    },
  )
})

describe('safeRedirectPath — fallback behaviour', () => {
  it('uses the default fallback when none is given', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/dashboard/profile')
  })
})
