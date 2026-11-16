/**
 * Brand editing rules shared by the brand form (desktop) and the phone edit
 * screen (Figma PR22).
 */
import type { BrandCategory } from '@/hooks/useBrands'
import { tEnums } from '@/i18n/ns/enums'
import { tBrands } from '@/i18n/ns/brands'
import { withLazyText } from '@/lib/opportunityLazyText'

const BRAND_CATEGORIES: BrandCategory[] = ['equipment', 'apparel', 'accessories', 'nutrition', 'technology', 'coaching', 'recruiting', 'media', 'services', 'other']

/** Category options; each label is read in the interface language when used. */
export const BRAND_CATEGORY_OPTIONS: { value: BrandCategory; label: string }[] = BRAND_CATEGORIES.map((value) =>
  withLazyText({ value }, { label: () => tEnums(`brandCategory.${value}`) }),
)

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
    return tBrands('editLib.invalidUrl')
  }
  // Reject obvious garbage. Real domains have at least one dot AND don't
  // contain whitespace in the host.
  const host = parsed.hostname
  if (!host || host.includes(' ') || !host.includes('.')) {
    return tBrands('editLib.invalidUrl')
  }
  if (/\s/.test(parsed.pathname)) {
    return tBrands('editLib.urlSpaces')
  }
  return null
}

const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/
// First path segments that are Instagram pages, not accounts (post / reel / story links).
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv', 'direct'])
// A bare value that is clearly a website, not a handle (dotted handles stay valid).
const LOOKS_LIKE_SITE = /^(www\.|instagram\.com$)|\.(com|net|org|io|app|store|shop|info|biz)$/i

/**
 * Instagram input → a stored link. Accepts "@brand", "brand", "brand.official",
 * "instagram.com/brand", mobile / short links and full URLs (share params
 * dropped). Post / reel / story links and website addresses are errors, so
 * neither lands in the Instagram field. Empty clears it.
 */
export function normalizeInstagram(raw: string): { url: string; error: null } | { url: null; error: string } {
  const value = raw.trim()
  if (!value) return { url: '', error: null }
  const fromUrl = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/@?([^/?#\s]+)/i)
  if (fromUrl && IG_RESERVED.has(fromUrl[1].toLowerCase())) {
    return { url: null, error: tBrands('editLib.instagramPostLink') }
  }
  const handle = fromUrl ? fromUrl[1] : /[/:]/.test(value) || LOOKS_LIKE_SITE.test(value.replace(/^@/, '')) ? null : value.replace(/^@/, '')
  if (!handle || !IG_HANDLE.test(handle)) return { url: null, error: tBrands('editLib.instagramInvalid') }
  return { url: `https://instagram.com/${handle}`, error: null }
}

/** "@handle" from a stored Instagram link or handle; null when it isn't one. */
export function instagramHandleOf(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null
  const r = normalizeInstagram(stored)
  return r.url ? r.url.replace('https://instagram.com/', '') : null
}
