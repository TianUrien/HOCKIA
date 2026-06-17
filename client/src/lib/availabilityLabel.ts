/**
 * Availability label — the single source of truth for the user-facing
 * availability signal shown on community cards, profiles, previews, and search.
 *
 * PRODUCT RULE (only positive signals): we ONLY ever show a positive,
 * role-specific label when the user has EXPLICITLY opted in. If they haven't,
 * we show NOTHING — never a negative state ("Not actively looking", "Not
 * currently open"), which reads as discouraging/prejudicial and makes a
 * profile look less relevant even when the person simply didn't set it.
 *
 * The label is driven by the role's OWN flag:
 *   player  → open_to_play                 → "Open to play"
 *   coach   → open_to_coach                → "Open to coach"
 *   umpire  → available_for_appointments   → "Open to umpire"
 *   brand   → open_to_opportunities        → "Open to partnerships"
 *   club    → open_to_opportunities        → "Recruiting"
 * Anything else (flag off, unknown role)   → null (render nothing).
 *
 * NOTE: `open_to_opportunities` for players/coaches is a separate BROADER-intent
 * flag (trials/transfers/sponsorships) that feeds the matching lenses; it is
 * deliberately NOT surfaced as its own visible chip — the role-specific
 * open_to_play / open_to_coach drives the displayed label.
 */

export type AvailabilityRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire' | string | null | undefined

export interface AvailabilityFlags {
  open_to_play?: boolean | null
  open_to_coach?: boolean | null
  open_to_opportunities?: boolean | null
  available_for_appointments?: boolean | null
}

/** Visual variant for callers that style the chip/pill differently per role. */
export type AvailabilityVariant = 'play' | 'coach' | 'umpire' | 'partnerships' | 'recruiting'

interface AvailabilityDescriptor {
  label: string
  variant: AvailabilityVariant
}

/**
 * The positive availability descriptor for a member, or null when there is no
 * positive signal to show. Use `.label` for text, `.variant` for styling.
 */
export function availabilityDescriptor(
  role: AvailabilityRole,
  flags: AvailabilityFlags,
): AvailabilityDescriptor | null {
  switch (role) {
    case 'player':
      return flags.open_to_play ? { label: 'Open to play', variant: 'play' } : null
    case 'coach':
      return flags.open_to_coach ? { label: 'Open to coach', variant: 'coach' } : null
    case 'umpire':
      return flags.available_for_appointments ? { label: 'Open to umpire', variant: 'umpire' } : null
    case 'brand':
      return flags.open_to_opportunities ? { label: 'Open to partnerships', variant: 'partnerships' } : null
    case 'club':
      return flags.open_to_opportunities ? { label: 'Recruiting', variant: 'recruiting' } : null
    default:
      return null
  }
}

/** The positive availability label for a member, or null when there's none. */
export function availabilityLabel(role: AvailabilityRole, flags: AvailabilityFlags): string | null {
  return availabilityDescriptor(role, flags)?.label ?? null
}

/**
 * Label for the community "open to …" quick-filter CHIP, by the active role tab
 * (no per-member flags — it's a filter toggle, not a member badge). The old chip
 * always said "Open to opportunities", which over-promised for players/coaches
 * whose availability flag is open_to_play / open_to_coach.
 */
export function availabilityFilterLabel(role: AvailabilityRole): string {
  switch (role) {
    case 'player': return 'Open to play'
    case 'coach': return 'Open to coach'
    case 'umpire': return 'Open to umpire'
    case 'club': return 'Recruiting'
    case 'brand': return 'Open to partnerships'
    default: return 'Open to opportunities' // 'all' / mixed roles
  }
}

/**
 * Whether the member shows a positive availability signal — drives the green
 * "open" dot on avatars. True only when there's a role-specific positive label.
 */
export function isOpenToAvailability(role: AvailabilityRole, flags: AvailabilityFlags): boolean {
  return availabilityDescriptor(role, flags) !== null
}
