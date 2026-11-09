/**
 * What to tell a member when a social sign-in comes back with an error.
 *
 * Supabase needs an email to create an account. A Facebook account made with
 * a phone number has none, and the provider returns "Error getting user
 * email from external provider". Retrying never helps there, so say what to
 * do instead (2026-11-09, before Facebook sign-in goes live).
 */
export const NO_EMAIL_MESSAGE =
  'Your Facebook account has no email address. Add one in Facebook, or sign up with email.'

export function oauthErrorMessage(description: string | null | undefined, fallback: string): string {
  const d = (description ?? '').toLowerCase()
  if (d.includes('email') && (d.includes('external provider') || d.includes('provider') || d.includes('missing'))) {
    return NO_EMAIL_MESSAGE
  }
  return fallback
}
