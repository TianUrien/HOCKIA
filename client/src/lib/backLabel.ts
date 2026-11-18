/**
 * Back labels name their destination (Figma checks, every leaf): the label
 * beside the chevron is the screen the player came from, read from the
 * router state the caller passed ({ from: pathname } or an explicit
 * { fromLabel }). Unknown or missing origin → the screen's own parent.
 */
import { tCommon } from '@/i18n/ns/common'

/** Each destination's name is a key in the common catalog (backLabel.*). */
const NAMES = [
  [/^\/opportunities\/applications\/?$/, 'backLabel.myApplications'],
  [/^\/opportunities\/?$/, 'backLabel.opportunities'],
  [/^\/opportunities\/[^/]+\/?$/, 'backLabel.role'],
  [/^\/home\b/, 'backLabel.home'],
  [/^\/messages\b/, 'backLabel.inbox'],
  [/^\/community\b/, 'backLabel.community'],
  [/^\/notifications\b/, 'backLabel.notifications'],
  [/^\/search\b/, 'backLabel.search'],
  [/^\/dashboard\/profile\b/, 'backLabel.profile'],
  [/^\/(players|coaches|clubs|umpires|brands)\//, 'backLabel.profile'],
] as const

export function backLabelFrom(state: unknown, fallback: string): string {
  const s = (state ?? {}) as { from?: unknown; fromLabel?: unknown }
  if (typeof s.fromLabel === 'string' && s.fromLabel.trim()) return s.fromLabel.trim()
  if (typeof s.from !== 'string') return fallback
  const path = s.from.split(/[?#]/)[0]
  const key = NAMES.find(([re]) => re.test(path))?.[1]
  return key ? tCommon(key) : fallback
}
