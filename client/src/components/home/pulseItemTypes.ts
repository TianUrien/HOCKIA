/**
 * Source of truth for which `item_type` values the frontend can render.
 *
 * PulseSection consults this to avoid stamping `seen_at` on rows the
 * dispatcher would have null-rendered — without this guard a future SQL
 * signal that ships before frontend support would be marked seen by the
 * mark-seen RPC and then sit in the user's feed forever (invisible AND
 * undismissible).
 *
 * Keep in sync with the switch in PulseCard.tsx.
 *
 * Lives in its own .ts file (not next to the dispatcher component) so
 * Vite's react-refresh rule about non-component named exports is happy.
 */
export const KNOWN_PULSE_ITEM_TYPES = new Set<string>([
  'snapshot_gain_celebration',
])

export function isKnownPulseItemType(itemType: string): boolean {
  return KNOWN_PULSE_ITEM_TYPES.has(itemType)
}
