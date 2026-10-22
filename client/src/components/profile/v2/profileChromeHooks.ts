import { useEffect, useState } from 'react'
import { setStatusBarForBackground } from '@/lib/nativeUi'

/** Height of the compact header under the safe area (Figma PR10/PR11). */
export const COMPACT_HEADER_PX = 52

/** True once `ref`'s bottom edge has passed under the compact header. */
export function useScrolledPast(ref: React.RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting), { rootMargin: `-${COMPACT_HEADER_PX + 48}px 0px 0px 0px` })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return past
}

/**
 * Status bar over a photo hero (Batch C, 2026-10-21): light glyphs while the
 * dark hero sits under the status bar, dark once the white compact glass
 * header appears; dark again on leaving. Native only (a web no-op).
 */
export function useHeroStatusBar(compactVisible: boolean): void {
  useEffect(() => {
    void setStatusBarForBackground(compactVisible ? 'light-bg' : 'dark-bg')
  }, [compactVisible])
  useEffect(() => () => { void setStatusBarForBackground('light-bg') }, [])
}
