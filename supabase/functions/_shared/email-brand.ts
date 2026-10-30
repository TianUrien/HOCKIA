// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

import { escapeHtml, safeHttpsUrl } from './html-escape.ts'

/**
 * Brand pieces every email shares (rebrand, 2026-10-30): the logo and the
 * avatar. Images are served by the web app from client/public/brand/email,
 * so they ship with the web release that matches this code (staging emails
 * read staging's copy through PUBLIC_SITE_URL).
 */
const SITE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

/** The horizontal ink lockup (stick mark + wordmark), like the web header. 28 high, 3x asset. */
export const EMAIL_LOGO_HTML =
  `<img src="${SITE_URL}/brand/email/hockia-lockup-ink-84h.png" alt="HOCKIA" width="136" height="28" style="display: block; height: 28px; width: 136px; border: 0;" />`

const PLACEHOLDER_ROLES = new Set(['player', 'coach', 'umpire', 'club', 'brand'])

/** The role's no-photo placeholder (the app's Avatar / Placeholder): gradient + silhouette, or the club / brand icon. Player when the role is unknown. */
export function placeholderAvatarUrl(role: string | null | undefined): string {
  const r = role && PLACEHOLDER_ROLES.has(role) ? role : 'player'
  return `${SITE_URL}/brand/email/placeholder-${r}-144.png`
}

/**
 * A person's avatar in an email: their https photo, otherwise the role
 * placeholder. Never initials (founder, 2026-10-26).
 */
export function emailAvatarHtml(avatarUrl: string | null | undefined, name: string, role: string | null | undefined, size = 48): string {
  const src = safeHttpsUrl(avatarUrl) ?? placeholderAvatarUrl(role)
  const r = Math.floor(size / 2)
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" width="${size}" height="${size}" style="display: block; width: ${size}px; height: ${size}px; border-radius: ${r}px; object-fit: cover; border: 0;" />`
}
