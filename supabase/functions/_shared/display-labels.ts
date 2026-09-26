/**
 * Human labels for the internal enum values Hockia AI works with.
 *
 * Why this exists: the no-results compose pass was handed criteria such as
 * `target_category: adult_men` and `availability: open_to_opportunities`,
 * and the model echoed them straight into the answer the user read. The fix
 * has two halves, both here:
 *
 *   1. `labelFor()` — translate a value BEFORE it reaches a prompt or a chip,
 *      so the model never sees the raw token in the first place.
 *   2. `scrubInternalValues()` — a last-line safety net over any model-written
 *      text, replacing known tokens (and any leftover snake_case word) with
 *      readable text.
 *
 * Pure, no Deno globals — unit-tested in display-labels.test.ts.
 */

const LABELS: Record<string, string> = {
  // Hockey categories (playing / coaching / target)
  adult_men: "Men's",
  adult_women: "Women's",
  girls: 'Girls',
  boys: 'Boys',
  mixed: 'Mixed',
  any: 'Any category',

  // Availability flags
  open_to_play: 'Open to play',
  open_to_coach: 'Open to coach',
  open_to_opportunities: 'Open to opportunities',

  // Player positions
  goalkeeper: 'Goalkeeper',
  defender: 'Defender',
  midfielder: 'Midfielder',
  forward: 'Forward',

  // Coach positions / specialisations
  head_coach: 'Head coach',
  assistant_coach: 'Assistant coach',
  youth_coach: 'Youth coach',
  goalkeeper_coach: 'Goalkeeper coach',
  strength_conditioning: 'Strength & conditioning coach',
  performance_analyst: 'Performance analyst',
  sports_scientist: 'Sports scientist',
  other_coach: 'Coach',

  // Opportunity / compensation vocabulary
  unpaid_development: 'Development (unpaid)',
  paid_contract: 'Paid contract',
  eu_passport: 'EU passport',

  // Fit tiers — only ever shown to recruiting viewers; labelled so a leak
  // never reads as a raw token.
  strong_match: 'Strong match',
  possible_match: 'Good match',
  needs_more_info: 'Needs more info',
}

/** Snake-case tokens only — single words like "girls" are left to context. */
const SNAKE_KEYS = Object.keys(LABELS).filter(k => k.includes('_'))

/**
 * Readable label for an internal value. Unknown snake_case values fall back
 * to "Words like this"; anything else is returned unchanged.
 */
export function labelFor(value: string | null | undefined): string {
  if (!value) return ''
  const v = String(value).trim()
  const hit = LABELS[v] ?? LABELS[v.toLowerCase()]
  if (hit) return hit
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/i.test(v)) {
    const words = v.toLowerCase().replace(/_/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  return v
}

/** Lower-case label for use mid-sentence ("men's", "open to play"). */
export function labelForInline(value: string | null | undefined): string {
  const l = labelFor(value)
  // Keep proper nouns / acronyms ("EU passport") intact.
  return /^EU\b/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1)
}

/**
 * Replace internal enum tokens in model-written copy with readable text.
 *
 * Known tokens map to their label (inline casing, since they sit
 * mid-sentence). Any remaining snake_case word is de-underscored — except
 * where it is clearly an identifier the user might need verbatim: a
 * @handle, a path or URL segment, or an e-mail address.
 */
export function scrubInternalValues(text: string | null | undefined): string {
  if (!text) return text ?? ''
  let out = text
  for (const key of SNAKE_KEYS) {
    const re = new RegExp(`(^|[^\\w@/.:-])${key}(?![\\w/])`, 'gi')
    out = out.replace(re, (_m, pre: string) => `${pre}${labelForInline(key)}`)
  }
  // Generic fallback for tokens we have no label for yet.
  out = out.replace(
    /(^|[^\w@/.:-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w/@])/g,
    (_m, pre: string, token: string) => `${pre}${token.replace(/_/g, ' ')}`,
  )
  return out
}
