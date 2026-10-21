import { useEffect, useState } from 'react'
import { isLowResCover } from '@/lib/coverQuality'

/**
 * The cover URLs (of `urls`) whose loaded image is narrower than 600 px, so
 * the caller can drop them and show the crest-gradient cover instead (Batch
 * C). `toSrc` maps a stored URL to the exact src the screen loads, so the
 * check reuses that request from the cache. Unmeasurable images (errors,
 * no DOM) are never marked.
 */
export function useLowResCovers(urls: string[], toSrc: (url: string) => string): Set<string> {
  const [low, setLow] = useState<Set<string>>(() => new Set())
  const key = urls.join('|')
  useEffect(() => {
    if (typeof Image === 'undefined') return
    let cancelled = false
    const imgs = urls.map((url) => {
      const img = new Image()
      img.onload = () => {
        if (cancelled || !isLowResCover(img.naturalWidth)) return
        setLow((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))
      }
      img.src = toSrc(url)
      return img
    })
    return () => {
      cancelled = true
      imgs.forEach((img) => { img.onload = null })
    }
    // toSrc is a pure mapping; the URL list is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return low
}
