// Pure (no Supabase import) so surfaces that only answer an invitation — the
// notifications store and drawer — never pull the Supabase client into tests.

import { tCommon } from '@/i18n/ns/common'

/** Toast copy — reused by every surface that answers an invitation, in the interface language. */
export function clubInviteAcceptedMessage(): string { return tCommon('clubInvite.accepted') }
export function clubInviteDeclinedMessage(): string { return tCommon('clubInvite.declined') }
export function clubInviteUnavailableMessage(): string { return tCommon('clubInvite.unavailable') }
export function clubInviteErrorMessage(): string { return tCommon('clubInvite.error') }

/**
 * English only, kept for callers not yet translated (hooks/useRespondToClubInvite
 * and its test). New code reads the functions above.
 * @deprecated
 */
export const CLUB_INVITE_ACCEPTED_MESSAGE = 'You joined the club.'
/** @deprecated English only; use clubInviteDeclinedMessage(). */
export const CLUB_INVITE_DECLINED_MESSAGE = 'Club invitation declined.'
/** @deprecated English only; use clubInviteUnavailableMessage(). */
export const CLUB_INVITE_UNAVAILABLE_MESSAGE = 'This invitation is no longer available.'
/** @deprecated English only; use clubInviteErrorMessage(). */
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
