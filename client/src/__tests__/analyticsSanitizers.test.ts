/**
 * analyticsSanitizers — pure-function PII scrubbers for GA4.
 *
 * The single most important assertion in this file: no UUID-shaped
 * string, no full name, and no raw profile ID can survive a round
 * trip through sanitizePath / pathToSafeTitle / hashUserId. These
 * are the bouncers at the GA boundary; if they regress, PII leaks.
 */

import { describe, it, expect } from 'vitest'
import {
  sanitizePath,
  pathToSafeTitle,
  hashId,
  hashUserId,
} from '@/lib/analyticsSanitizers'

const SAMPLE_UUID = '9a34cbdf-10f9-48f5-89d6-fc071db95c60'
const SECOND_UUID = '38965930-2a53-47bf-85af-a0e9852c257b'

describe('sanitizePath', () => {
  it('replaces a UUID segment with :id', () => {
    expect(sanitizePath(`/players/id/${SAMPLE_UUID}`)).toBe('/players/id/:id')
    expect(sanitizePath(`/coaches/id/${SAMPLE_UUID}`)).toBe('/coaches/id/:id')
    expect(sanitizePath(`/admin/users/${SAMPLE_UUID}`)).toBe('/admin/users/:id')
  })

  it('handles UUIDs anywhere in the path', () => {
    expect(sanitizePath(`/x/${SAMPLE_UUID}/y/${SECOND_UUID}/z`)).toBe('/x/:id/y/:id/z')
  })

  it('preserves paths with no identifiers', () => {
    expect(sanitizePath('/home')).toBe('/home')
    expect(sanitizePath('/discover/players')).toBe('/discover/players')
    expect(sanitizePath('/admin/ai-opinions')).toBe('/admin/ai-opinions')
  })

  it('strips UUIDs from query strings too', () => {
    expect(sanitizePath(`/notifications?related=${SAMPLE_UUID}`)).toBe(
      '/notifications?related=:id',
    )
    expect(
      sanitizePath(`/x?a=${SAMPLE_UUID}&b=plain&c=${SECOND_UUID}`),
    ).toBe('/x?a=:id&b=plain&c=:id')
  })

  it('handles uppercase UUIDs (some legacy URLs)', () => {
    const upper = SAMPLE_UUID.toUpperCase()
    expect(sanitizePath(`/players/id/${upper}`)).toBe('/players/id/:id')
  })

  it('returns empty/undefined inputs unchanged', () => {
    expect(sanitizePath('')).toBe('')
  })

  it('does NOT match non-UUID hex strings of similar length', () => {
    // 32 hex chars without hyphens — looks like a UUID without the
    // structure; should NOT be matched.
    const noHyphens = '9a34cbdf10f948f589d6fc071db95c60'
    expect(sanitizePath(`/x/${noHyphens}`)).toBe(`/x/${noHyphens}`)
  })
})

describe('pathToSafeTitle', () => {
  it('returns a generic title for identifying routes', () => {
    expect(pathToSafeTitle('/players/id/:id', 'Valentina — Player | HOCKIA')).toBe(
      'Player profile | HOCKIA',
    )
    expect(pathToSafeTitle('/coaches/id/:id', 'John — Coach | HOCKIA')).toBe(
      'Coach profile | HOCKIA',
    )
    expect(pathToSafeTitle('/clubs/id/:id', 'AFC | HOCKIA')).toBe('Club profile | HOCKIA')
    expect(pathToSafeTitle('/umpires/id/:id', 'Pat | HOCKIA')).toBe('Umpire profile | HOCKIA')
    expect(pathToSafeTitle('/brands/nike', 'Nike | HOCKIA')).toBe('Brand profile | HOCKIA')
    expect(pathToSafeTitle('/opportunities/:id', 'Goalkeeper wanted | HOCKIA')).toBe(
      'Opportunity detail | HOCKIA',
    )
    expect(pathToSafeTitle('/admin/users/:id', 'tianurien | Admin | HOCKIA')).toBe(
      'Admin user detail | HOCKIA',
    )
    expect(pathToSafeTitle('/conversations/:id', 'Chat with Maria | HOCKIA')).toBe(
      'Conversation | HOCKIA',
    )
  })

  it('returns the fallback title for non-identifying routes', () => {
    expect(pathToSafeTitle('/home', 'Feed | HOCKIA')).toBe('Feed | HOCKIA')
    expect(pathToSafeTitle('/admin/ai-opinions', 'AI Opinions | HOCKIA Admin')).toBe(
      'AI Opinions | HOCKIA Admin',
    )
    expect(pathToSafeTitle('/dashboard/profile', 'My profile | HOCKIA')).toBe(
      'My profile | HOCKIA',
    )
  })

  it('overrides even when the fallback title contains identifying content', () => {
    // The whole point: an identifying route should ALWAYS produce
    // the generic title, regardless of what document.title contains.
    expect(
      pathToSafeTitle('/players/id/:id', 'Real Full Name Here — Player | HOCKIA'),
    ).not.toContain('Real Full Name Here')
  })
})

describe('hashId', () => {
  it('returns a 16-char hex string', async () => {
    const hash = await hashId(SAMPLE_UUID)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic — same input produces same hash (preserves grouping signal in GA)', async () => {
    const a = await hashId(SAMPLE_UUID)
    const b = await hashId(SAMPLE_UUID)
    expect(a).toBe(b)
  })

  it('different inputs produce different hashes', async () => {
    const a = await hashId(SAMPLE_UUID)
    const b = await hashId(SECOND_UUID)
    expect(a).not.toBe(b)
  })

  it('output does NOT contain the raw UUID', async () => {
    // The whole point of hashing: GA param values can't be reversed
    // to a Supabase row even if someone exfiltrated the GA data set.
    const hash = await hashId(SAMPLE_UUID)
    expect(hash).not.toContain(SAMPLE_UUID)
    // Stronger: shouldn't contain any 8-char substring of the UUID.
    expect(hash).not.toContain(SAMPLE_UUID.slice(0, 8))
  })

  it('namespace prefix means the hash differs from a generic sha256 of the UUID', async () => {
    // Defends against rainbow-table reverse — even if someone has a
    // pre-computed sha256 table for UUIDs, our hashes won't match
    // because they include the "hockia-analytics:" namespace.
    const ourHash = await hashId(SAMPLE_UUID)
    // Generic sha256(UUID) — what an attacker might try first.
    const encoder = new TextEncoder()
    const buf = await crypto.subtle.digest('SHA-256', encoder.encode(SAMPLE_UUID))
    const genericHash = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16)
    expect(ourHash).not.toBe(genericHash)
  })

  it('hashUserId is a back-compat alias for hashId (same algorithm)', async () => {
    const viaAlias = await hashUserId(SAMPLE_UUID)
    const viaCanonical = await hashId(SAMPLE_UUID)
    expect(viaAlias).toBe(viaCanonical)
  })
})
