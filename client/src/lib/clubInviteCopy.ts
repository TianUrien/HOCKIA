// Pure (no Supabase import) so surfaces that only answer an invitation — the
// notifications store and drawer — never pull the Supabase client into tests.

/** Toast copy — reused by every surface that answers an invitation. */
export const CLUB_INVITE_ACCEPTED_MESSAGE = 'You joined the club.'
export const CLUB_INVITE_DECLINED_MESSAGE = 'Club invitation declined.'
export const CLUB_INVITE_UNAVAILABLE_MESSAGE = 'This invitation is no longer available.'
export const CLUB_INVITE_ERROR_MESSAGE = 'Could not update the club invitation. Please try again.'

/**
 * respond_to_club_invite errors that mean the invitation is gone rather than
 * that something failed: the club cancelled it (row deleted → "not found") or
 * it was already answered on another device ("no longer pending").
 */
export function isClubInviteUnavailable(error: string | null | undefined): boolean {
  if (!error) return false
  return /invitation not found|no longer pending/i.test(error)
}

/** Query-key root for the viewer's pending invitations (see useMyClubInvitations). */
export const MY_CLUB_INVITATIONS_KEY = ['club-invitations', 'mine'] as const
