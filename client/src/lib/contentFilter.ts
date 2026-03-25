/**
 * Basic content filter for objectionable text (Apple Guideline 1.2).
 *
 * Checks user-generated content for prohibited patterns before submission.
 * This is a first-pass client-side filter — server-side moderation
 * (admin review of reports) provides the second layer.
 */

// Common slurs and extreme hate speech patterns (case-insensitive)
// This is intentionally a minimal list targeting the most severe violations.
// Moderate content is handled via user reporting + admin review.
const BLOCKED_PATTERNS = [
  /\bn[i1]gg[ae3]r/i,
  /\bf[a@]gg[o0]t/i,
  /\bk[i1]ke\b/i,
  /\bsp[i1]c\b/i,
  /\bch[i1]nk\b/i,
  /\bwetback/i,
  /\btr[a@]nn[yi]/i,
  /\bkill\s+(yourself|urself|ur\s*self)/i,
  /\bgo\s+die\b/i,
  /\bI('ll|.*will)\s+kill\s+(you|u)\b/i,
]

export interface ContentFilterResult {
  allowed: boolean
  reason?: string
}

/**
 * Check if text content passes the content filter.
 * Returns { allowed: true } if content is acceptable,
 * or { allowed: false, reason } if content is blocked.
 */
export function checkContent(text: string): ContentFilterResult {
  if (!text) return { allowed: true }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return {
        allowed: false,
        reason: 'Your message contains language that violates our community guidelines. Please revise and try again.',
      }
    }
  }

  return { allowed: true }
}
