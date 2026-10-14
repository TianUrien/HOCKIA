import { ArrowLeft, ChevronLeft } from 'lucide-react'
import { ANDROID_CHROME } from '@/lib/platformChrome'

interface BackGlyphProps {
  className?: string
  strokeWidth?: number
}

/**
 * The glyph inside every phone back button: the iOS chevron, or the
 * Material back arrow in the Android app (Figma PR1-A 118:745). Labels next
 * to it ("Inbox", "Back to …") are an iOS convention; callers hide them when
 * `ANDROID_CHROME` is on.
 */
export function BackGlyph({ className, strokeWidth = 2 }: BackGlyphProps) {
  return ANDROID_CHROME
    ? <ArrowLeft className={className} strokeWidth={strokeWidth} aria-hidden="true" />
    : <ChevronLeft className={className} strokeWidth={strokeWidth} aria-hidden="true" />
}
