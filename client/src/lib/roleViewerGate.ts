/**
 * Who can act on a role page (design audit 2026-10-21, A7). The role page
 * was player-first: a coach on a player role hit a dead end with no reason,
 * and brands and umpires read apply copy ("Ask the club when you apply")
 * they can never act on. Non-applicants now get one plain note at the end of
 * the page and keep Message; apply copy is for applicants only.
 */
export type RoleViewerKind = 'applicant' | 'wrong_type' | 'browse_only' | 'publisher' | 'guest' | 'other'

export interface RoleViewerGate {
  kind: RoleViewerKind
  /** The end note shown instead of Apply, or null. */
  note: string | null
  /** Whether apply copy ("Ask the club when you apply", How applying works) is shown. */
  applyCopy: boolean
  /** Whether a Message action is offered without Apply. */
  messageOnly: boolean
}

export const COACH_ON_PLAYER_ROLE_NOTE = 'This role is for players. Coaching roles are in Opportunities.'
export const PLAYER_ON_COACH_ROLE_NOTE = 'This role is for coaches. Player roles are in Opportunities.'
export const UMPIRE_BROWSE_NOTE = 'You can browse roles here. Umpire appointments and assessments will live here when we open them.'
export const BRAND_BROWSE_NOTE = 'You can browse roles here. Applying is for players and coaches.'

export function roleViewerGate(o: {
  viewerRole: string | null | undefined
  roleType: string | null | undefined
  isPublisher: boolean
  signedIn: boolean
}): RoleViewerGate {
  if (o.isPublisher) return { kind: 'publisher', note: null, applyCopy: false, messageOnly: false }
  // Guests see the role as a player would; Apply leads to the join sheet.
  if (!o.signedIn) return { kind: 'guest', note: null, applyCopy: true, messageOnly: false }
  const type = o.roleType ?? 'player'
  switch (o.viewerRole) {
    case 'player':
      return type === 'player'
        ? { kind: 'applicant', note: null, applyCopy: true, messageOnly: false }
        : { kind: 'wrong_type', note: PLAYER_ON_COACH_ROLE_NOTE, applyCopy: false, messageOnly: true }
    case 'coach':
      return type === 'coach'
        ? { kind: 'applicant', note: null, applyCopy: true, messageOnly: false }
        : { kind: 'wrong_type', note: COACH_ON_PLAYER_ROLE_NOTE, applyCopy: false, messageOnly: true }
    case 'umpire':
      return { kind: 'browse_only', note: UMPIRE_BROWSE_NOTE, applyCopy: false, messageOnly: true }
    case 'brand':
      return { kind: 'browse_only', note: BRAND_BROWSE_NOTE, applyCopy: false, messageOnly: true }
    default:
      // Clubs and anything else: no apply copy, no note (unchanged).
      return { kind: 'other', note: null, applyCopy: false, messageOnly: false }
  }
}
