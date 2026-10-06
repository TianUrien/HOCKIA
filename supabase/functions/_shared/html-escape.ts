/**
 * HTML helpers for transactional emails. Every member-supplied value (names,
 * titles, clubs, cities…) goes through escapeHtml before it is placed in an
 * email body or attribute; avatar images are only rendered from https URLs.
 */

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The URL when it is an absolute https URL, else null (the image is omitted). */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
