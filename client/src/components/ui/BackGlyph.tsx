import { ArrowLeft, ChevronLeft } from 'lucide-react'
import { ANDROID_CHROME } from '@/lib/platformChrome'

interface BackGlyphProps {
  className?: string
  strokeWidth?: number
  /** Which chrome to draw. Defaults to the app's own (ANDROID_CHROME). */
  chrome?: 'android' | 'ios'
}

/**
 * The glyph inside every phone back button: the iOS chevron, or the
 * Material back arrow in the Android app (Figma PR1-A 118:745). Labels next
 * to it ("Inbox", "Back to …") are an iOS convention; callers hide them when
 * `ANDROID_CHROME` is on.
 */
export function BackGlyph({ className, strokeWidth = 2, chrome = ANDROID_CHROME ? 'android' : 'ios' }: BackGlyphProps) {
  return chrome === 'android'
    ? <ArrowLeft className={className} strokeWidth={strokeWidth} aria-hidden="true" />
    : <ChevronLeft className={className} strokeWidth={strokeWidth} aria-hidden="true" />
}
