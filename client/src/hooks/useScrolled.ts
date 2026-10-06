import { useEffect, useState } from 'react'

/** The landing navbar's capsule threshold (Figma Landing v3: scrollY > 8). */
export const NAV_SCROLL_THRESHOLD = 8

/**
 * True once `window.scrollY` has passed `threshold`. One passive scroll
 * listener, no rAF: the value is a boolean, so React only re-renders when
 * it actually flips.
 */
export function useScrolled(threshold = NAV_SCROLL_THRESHOLD): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}
