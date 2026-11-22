/**
 * What to tell a member when a social sign-in comes back with an error.
 *
 * Supabase needs an email to create an account. A Facebook account made with
 * a phone number has none, and the provider returns "Error getting user
 * email from external provider". Retrying never helps there, so say what to
 * do instead (2026-11-09, before Facebook sign-in goes live).
 */
import { tAuth } from '@/i18n/ns/auth'

/** A function, not a constant: the words follow the interface language. */
export function noEmailMessage(): string {
  return tAuth('errors.oauthNoEmail')
}

/**
 * Supabase answers "User is banned" when the account's access is closed: a
 * frozen under-18 account (the age gate closes access together with the
 * goodbye email) or a moderation block. The server does not say which, so
 * the words fit both. Retrying never helps, and it is not a fault to report
 * (2026-11-22: frozen members retried up to four times on "Sign-in failed").
 */
export function isAccountUnavailable(description: string | null | undefined): boolean {
  return /user is banned|user_banned/i.test(description ?? '')
}

export function accountUnavailableMessage(): string {
  return tAuth('errors.accountUnavailable')
}

export function oauthErrorMessage(description: string | null | undefined, fallback: string): string {
  if (isAccountUnavailable(description)) return accountUnavailableMessage()
  const d = (description ?? '').toLowerCase()
  if (d.includes('email') && (d.includes('external provider') || d.includes('provider') || d.includes('missing'))) {
    return noEmailMessage()
  }
  return fallback
}
