import { useEffect } from 'react'

interface PublicProfileMetaInput {
  /** Display name — appears in document.title and OG title. */
  displayName: string | null | undefined
  /** Role label used in the description copy ("player", "coach", "club", etc). */
  roleLabel: string
  /**
   * Optional one-line description (bio, club tagline, etc.) — falls back
   * to a role-generic line when missing.
   */
  description?: string | null
  /** Absolute canonical URL for og:url (e.g. https://inhockia.com/players/<slug>). */
  canonicalUrl?: string
}

const DEFAULT_TITLE = 'HOCKIA | Field Hockey Community'
const DEFAULT_DESC = 'Connect players, coaches, and clubs. Raise the sport together. Join HOCKIA.'

/**
 * Mutates document.title + og/twitter meta tags for a public profile page.
 * Mirrors the pattern in OpportunityDetailPage. Restores defaults on
 * unmount so subsequent route changes don't inherit profile-specific tags.
 *
 * Per-profile dynamic OG images are deferred — link previews currently
 * show the site default image. Title and description ARE per-profile,
 * which is enough for WhatsApp / Slack / iMessage previews to surface
 * the right person.
 */
export function usePublicProfileMeta(input: PublicProfileMetaInput): void {
  const { displayName, roleLabel, description, canonicalUrl } = input

  useEffect(() => {
    if (!displayName) return

    const title = `${displayName} — ${capitalize(roleLabel)} | HOCKIA`
    const desc = description
      ? truncate(description, 155)
      : `${displayName}'s public ${roleLabel} profile on HOCKIA — career, references, and more.`

    document.title = title

    const metaDesc = document.querySelector('meta[name="description"]')
    metaDesc?.setAttribute('content', desc)

    const ogTitle = document.querySelector('meta[property="og:title"]')
    ogTitle?.setAttribute('content', title)
    const ogDesc = document.querySelector('meta[property="og:description"]')
    ogDesc?.setAttribute('content', desc)
    const ogUrl = document.querySelector('meta[property="og:url"]')
    if (canonicalUrl) ogUrl?.setAttribute('content', canonicalUrl)

    const twTitle = document.querySelector('meta[name="twitter:title"]')
    twTitle?.setAttribute('content', title)
    const twDesc = document.querySelector('meta[name="twitter:description"]')
    twDesc?.setAttribute('content', desc)

    return () => {
      document.title = DEFAULT_TITLE
      metaDesc?.setAttribute('content', DEFAULT_DESC)
      ogTitle?.setAttribute('content', DEFAULT_TITLE)
      ogDesc?.setAttribute('content', DEFAULT_DESC)
      ogUrl?.setAttribute('content', 'https://inhockia.com')
      twTitle?.setAttribute('content', DEFAULT_TITLE)
      twDesc?.setAttribute('content', DEFAULT_DESC)
    }
  }, [displayName, roleLabel, description, canonicalUrl])
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}
