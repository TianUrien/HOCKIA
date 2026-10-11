import { useEffect, useState } from 'react'

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
