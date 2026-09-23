import { useEffect, useRef, useState } from 'react'

/**
 * True once the element is within `margin` of the viewport — and stays true.
 * Default 250% vertically: media starts loading two and a half screens ahead —
 * on a slow link a fast flick covers 1.5 screens before a 400px tile arrives,
 * so 150% left tiles entering empty (measured on Slow 4G). `eager` skips the wait (the
 * first tiles of a screen).
 */
export function useNearViewport<T extends HTMLElement>(eager = false, margin = '250% 0px') {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(eager)
  useEffect(() => {
    if (near) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect() } }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])
  return { ref, near }
}
