import { trackCtaClick } from '@/lib/analytics'

/**
 * StoreBadges — official App Store + Google Play download CTAs.
 *
 * Single source of truth for the store links so every surface (Landing hero,
 * future footer, etc.) stays in sync. Badges are the OFFICIAL, unmodified
 * artwork shipped in the canonical brand library:
 *   - Apple: developer.apple.com "Download on the App Store" (blk, SVG)
 *   - Google: play.google.com generic web badge (clear-space border trimmed;
 *     the mandated clear space is re-provided here via the flex `gap`).
 *
 * URLs mirror getStoreUrl() in lib/appVersion.ts. Both apps.apple.com and
 * play.google.com auto-route the visitor to their regional store listing
 * (or the web listing when the store app isn't installed), so a single link
 * works worldwide.
 */

// Kept in sync with getStoreUrl() (lib/appVersion.ts).
export const APP_STORE_URL = 'https://apps.apple.com/app/hockia/id6760937891'
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.inhockia.app'

interface StoreBadgesProps {
  /** Wrapper classes — control alignment/spacing at the call site. */
  className?: string
  /** Tailwind height class for the badges (equal height keeps them aligned). */
  heightClass?: string
  /** Analytics context, e.g. "landing_hero". */
  source?: string
}

export default function StoreBadges({
  className = '',
  heightClass = 'h-11',
  source = 'landing_hero',
}: StoreBadgesProps) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackCtaClick('app_store_ios', source)}
        className="inline-flex rounded-xl transition-transform duration-200 hover:scale-[1.04] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <img
          src="/brand/badges/apple-app-store-badge.svg"
          alt="Download HOCKIA on the App Store"
          className={`${heightClass} w-auto`}
          draggable={false}
        />
      </a>

      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackCtaClick('google_play_android', source)}
        className="inline-flex rounded-xl transition-transform duration-200 hover:scale-[1.04] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <img
          src="/brand/badges/google-play-badge.png"
          alt="Get HOCKIA on Google Play"
          className={`${heightClass} w-auto`}
          draggable={false}
        />
      </a>
    </div>
  )
}
