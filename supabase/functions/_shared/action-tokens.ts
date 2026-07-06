/**
 * One-click email-action tokens (email_action_tokens table).
 *
 * The raw token travels ONLY in the email link; the database stores its
 * SHA-256 hex digest (token_hash), so a DB read can never be replayed as a
 * link. 32 random bytes → base64url ≈ 43 chars, unguessable.
 */

/** Mint a new raw token (base64url, no padding). Goes into the email link. */
export function mintRawToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 hex digest of a raw token — the at-rest form (token_hash). */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
