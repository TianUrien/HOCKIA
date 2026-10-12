/**
 * Brand editing rules shared by the brand form (desktop) and the phone edit
 * screen (Figma PR22).
 */
import type { BrandCategory } from '@/hooks/useBrands'

export const BRAND_CATEGORY_OPTIONS: { value: BrandCategory; label: string }[] = [
  { value: 'equipment', label: 'Equipment' },
  { value: 'apparel', label: 'Apparel' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'technology', label: 'Technology' },
  { value: 'coaching', label: 'Coaching & Training' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'media', label: 'Media' },
  { value: 'services', label: 'Services' },
  { value: 'other', label: 'Other' },
]

/**
 * Validate a website / social URL. Returns an error string, or null if OK.
 * Empty input is OK (the field is optional).
 *
 * Uses the WHATWG URL constructor for parsing — that catches malformed
 * structures like "not a url" → after the auto-https-prefix becomes
 * "https://not a url" which DOES parse (the URL spec is permissive about
 * hostnames) but fails the secondary checks (no dot, no path, contains
 * whitespace). Belt + braces.
 */
export function validateBrandUrl(rawValue: string): string | null {
  const value = rawValue.trim()
  if (!value) return null // optional field
  // Prefix-aware: the onBlur handler already adds https:// if missing,
  // but on submit we may still see raw input. Try both shapes.
  const candidate = value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `https://${value}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return 'That doesn\'t look like a valid URL.'
  }
  // Reject obvious garbage. Real domains have at least one dot AND don't
  // contain whitespace in the host.
  const host = parsed.hostname
  if (!host || host.includes(' ') || !host.includes('.')) {
    return 'That doesn\'t look like a valid URL.'
  }
  if (/\s/.test(parsed.pathname)) {
    return 'URLs cannot contain spaces.'
  }
  return null
}

const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/

/**
 * Instagram input → a stored link. Accepts "@brand", "brand", "brand.official",
 * "instagram.com/brand" or a full URL (share params dropped). Anything that
 * isn't an Instagram handle or link is an error, so a website can't land in
 * the Instagram field. Empty clears it.
 */
export function normalizeInstagram(raw: string): { url: string; error: null } | { url: null; error: string } {
  const value = raw.trim()
  if (!value) return { url: '', error: null }
  const fromUrl = value.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/@?([^/?#\s]+)/i)
  const handle = fromUrl ? fromUrl[1] : /[/:]/.test(value) ? null : value.replace(/^@/, '')
  if (!handle || !IG_HANDLE.test(handle)) return { url: null, error: 'Enter an Instagram handle (@yourbrand) or link.' }
  return { url: `https://instagram.com/${handle}`, error: null }
}

/** "@handle" from a stored Instagram link or handle; null when it isn't one. */
export function instagramHandleOf(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null
  const r = normalizeInstagram(stored)
  return r.url ? r.url.replace('https://instagram.com/', '') : null
}
