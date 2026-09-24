/**
 * Back labels name their destination (Figma checks, every leaf): the label
 * beside the chevron is the screen the player came from, read from the
 * router state the caller passed ({ from: pathname } or an explicit
 * { fromLabel }). Unknown or missing origin → the screen's own parent.
 */
const NAMES: [RegExp, string][] = [
  [/^\/opportunities\/applications\/?$/, 'My applications'],
  [/^\/opportunities\/?$/, 'Opportunities'],
  [/^\/opportunities\/[^/]+\/?$/, 'Role'],
  [/^\/home\b/, 'Home'],
  [/^\/messages\b/, 'Inbox'],
  [/^\/community\b/, 'Community'],
  [/^\/notifications\b/, 'Notifications'],
  [/^\/search\b/, 'Search'],
  [/^\/dashboard\/profile\b/, 'Profile'],
  [/^\/(players|coaches|clubs|umpires|brands)\//, 'Profile'],
]

export function backLabelFrom(state: unknown, fallback: string): string {
  const s = (state ?? {}) as { from?: unknown; fromLabel?: unknown }
  if (typeof s.fromLabel === 'string' && s.fromLabel.trim()) return s.fromLabel.trim()
  if (typeof s.from !== 'string') return fallback
  const path = s.from.split(/[?#]/)[0]
  return NAMES.find(([re]) => re.test(path))?.[1] ?? fallback
}
