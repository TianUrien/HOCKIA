/**
 * Profile-share utilities — URL builders, role-specific copy, and the
 * channel handlers powering ShareProfileButton.
 *
 * Channels: copy link · native share (navigator.share) · WhatsApp · email.
 *
 * Pure functions only — no React. Tested in isolation by
 * client/src/__tests__/profileShare.test.ts.
 */

import { Capacitor } from '@capacitor/core'

export type ShareableRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

/**
 * Canonical public URL used when sharing from inside the iOS/Android app.
 *
 * The Capacitor shell loads the bundled web assets from a local scheme
 * (`capacitor://localhost` on iOS, `http://localhost` on Android). Using
 * `window.location.origin` for shareable URLs would generate dead links
 * that no external recipient can open.
 *
 * On native, always pin to the production web origin. On web, keep using
 * `window.location.origin` so staging/preview deploys produce links that
 * point back to themselves (so QA links work).
 */
const PUBLIC_BASE_URL = 'https://inhockia.com'

export function getShareOrigin(): string {
  if (Capacitor.isNativePlatform()) return PUBLIC_BASE_URL
  if (typeof window !== 'undefined') return window.location.origin
  return PUBLIC_BASE_URL
}

export interface ShareableProfile {
  role: ShareableRole
  // Allow `undefined` so callers don't have to coerce profile types from
  // dashboards that model the column as optional. Treated as "no username"
  // identically to null.
  username: string | null | undefined
  id: string
}

/**
 * Build the absolute, externally-shareable URL for a profile.
 * Prefers `username` for human-readable links, falls back to `id/<uuid>`.
 *
 * Brand uses /brands/:slug; non-brand roles use /<role>s/:username.
 * `members` alias is intentionally not used here — share copy reads
 * better when the URL matches the role.
 */
export function buildProfileUrl(profile: ShareableProfile, origin: string): string {
  const slug = profile.username || `id/${profile.id}`
  const base = pathBaseForRole(profile.role)
  return `${origin}${base}/${slug}`
}

function pathBaseForRole(role: ShareableRole): string {
  switch (role) {
    case 'player': return '/players'
    case 'coach': return '/coaches'
    case 'club': return '/clubs'
    case 'umpire': return '/umpires'
    case 'brand': return '/brands'
  }
}

// ---------------------------------------------------------------------------
// Role-specific share copy
// ---------------------------------------------------------------------------
// Tone: first-person for individuals, first-person plural for orgs.
// Each line ends with a colon followed by the URL — keeps the link
// at the tail so WhatsApp link-previews target the right text.

interface RoleCopy {
  shortMessage: (url: string) => string
  emailSubject: string
  emailBody: (url: string) => string
}

const COPY: Record<ShareableRole, RoleCopy> = {
  player: {
    shortMessage: (url) =>
      `Here’s my HOCKIA profile — hockey background, videos, and references: ${url}`,
    emailSubject: 'My HOCKIA player profile',
    emailBody: (url) =>
      `Hi,\n\nHere’s my HOCKIA profile — it has my hockey background, videos, and references:\n\n${url}\n\nThanks!`,
  },
  coach: {
    shortMessage: (url) =>
      `Here’s my HOCKIA coaching profile — experience, background, and references: ${url}`,
    emailSubject: 'My HOCKIA coaching profile',
    emailBody: (url) =>
      `Hi,\n\nHere’s my HOCKIA coaching profile — it has my coaching experience, background, and references:\n\n${url}\n\nThanks!`,
  },
  umpire: {
    shortMessage: (url) =>
      `Here’s my HOCKIA umpire profile — officiating background and references: ${url}`,
    emailSubject: 'My HOCKIA umpire profile',
    emailBody: (url) =>
      `Hi,\n\nHere’s my HOCKIA umpire profile — it has my officiating background and references:\n\n${url}\n\nThanks!`,
  },
  club: {
    shortMessage: (url) =>
      `Here’s our HOCKIA club profile: ${url}`,
    emailSubject: 'Our HOCKIA club profile',
    emailBody: (url) =>
      `Hi,\n\nHere’s our HOCKIA club profile:\n\n${url}\n\nThanks!`,
  },
  brand: {
    shortMessage: (url) =>
      `Here’s our HOCKIA brand profile: ${url}`,
    emailSubject: 'Our HOCKIA brand profile',
    emailBody: (url) =>
      `Hi,\n\nHere’s our HOCKIA brand profile:\n\n${url}\n\nThanks!`,
  },
}

export function shareMessage(role: ShareableRole, url: string): string {
  return COPY[role].shortMessage(url)
}

export function shareEmail(role: ShareableRole, url: string): { subject: string; body: string } {
  return { subject: COPY[role].emailSubject, body: COPY[role].emailBody(url) }
}

// ---------------------------------------------------------------------------
// Channel URL builders
// ---------------------------------------------------------------------------

export function whatsappShareUrl(role: ShareableRole, profileUrl: string): string {
  const text = shareMessage(role, profileUrl)
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export function mailtoShareUrl(role: ShareableRole, profileUrl: string): string {
  const { subject, body } = shareEmail(role, profileUrl)
  // Manual encoding (don't use URLSearchParams) — `mailto:` requires
  // plus-signs to remain `+`, and URLSearchParams encodes spaces as
  // `+` which mail clients then render as literal `+`.
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
