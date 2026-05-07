import { useState } from 'react'

/**
 * Flag — single source of truth for country flag rendering.
 *
 * Uses flagcdn.com PNG images (rather than the OS-native flag emoji) so
 * the visual treatment is consistent across operating systems. Windows
 * users in particular don't render flag emoji at all by default; the PNG
 * approach gives every viewer the same recognisable square flag.
 *
 * Falls back to the emoji (or an unknown-flag glyph) when the country
 * code is missing — keeps existing data without country_code from
 * silently rendering nothing. Also handles network/404 errors on the
 * PNG by swapping to the emoji fallback at render time, so a flagcdn
 * outage or an invalid 2-letter code never shows the browser's
 * broken-image icon to users.
 *
 * Usage:
 *   <Flag code="ar" />              // Argentina, default 16px height
 *   <Flag code="gb" size="md" />    // 20px
 *   <Flag code={null} fallbackEmoji={country?.flag_emoji} />
 *
 * Sizes: sm=16h · md=20h · lg=24h. Width auto from intrinsic aspect.
 */

interface FlagProps {
  /**
   * ISO 3166-1 alpha-2 country code (case-insensitive). When provided,
   * a flagcdn PNG is rendered. When null/undefined, fallbackEmoji or a
   * placeholder glyph renders.
   */
  code?: string | null
  /** Country name for the alt attribute. Defaults to the code. */
  countryName?: string | null
  /**
   * Emoji to render when no code is available. If omitted and code is
   * missing, a generic unknown-flag glyph (🏳️) is used.
   */
  fallbackEmoji?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_TO_HEIGHT: Record<NonNullable<FlagProps['size']>, string> = {
  sm: 'h-3',   // 12px
  md: 'h-4',   // 16px
  lg: 'h-5',   // 20px
}

const SIZE_TO_FLAGCDN_WIDTH: Record<NonNullable<FlagProps['size']>, string> = {
  // flagcdn supports w20 / w40 / w80 / w160 / w320 / w640. Pick the
  // smallest that comfortably scales for retina (2x).
  sm: 'w20',
  md: 'w40',
  lg: 'w40',
}

export default function Flag({
  code,
  countryName,
  fallbackEmoji,
  size = 'md',
  className = '',
}: FlagProps) {
  const heightClass = SIZE_TO_HEIGHT[size]
  // Track image-load failure (network error / 404 / invalid code) so we
  // can swap to the emoji fallback instead of leaving a broken-image
  // icon on the page.
  const [imgFailed, setImgFailed] = useState(false)

  if (code && !imgFailed) {
    const lowerCode = code.toLowerCase()
    const widthVariant = SIZE_TO_FLAGCDN_WIDTH[size]
    return (
      <img
        src={`https://flagcdn.com/${widthVariant}/${lowerCode}.png`}
        alt={countryName ?? lowerCode.toUpperCase()}
        // Inline-block so the flag aligns with surrounding text.
        // rounded-[2px] gives the PNG a tiny corner so it doesn't look
        // like a sharp-edged screenshot. Object-contain preserves aspect.
        className={`inline-block ${heightClass} w-auto rounded-[2px] object-contain ${className}`}
        loading="lazy"
        decoding="async"
        onError={() => setImgFailed(true)}
      />
    )
  }

  // No code, or image load failed → fallback to emoji or unknown glyph.
  // Span keeps inline flow.
  return (
    <span className={`inline-block ${className}`} aria-label={countryName ?? 'Country'}>
      {fallbackEmoji || '🏳️'}
    </span>
  )
}
