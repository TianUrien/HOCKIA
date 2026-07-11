import { useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { trackDbEvent } from './trackDbEvent'
import { useAuthStore } from './auth'
import { logger } from './logger'

/**
 * Home redesign instrumentation (Phase 0, §4 of the brief).
 *
 * Three signals, two write paths:
 *  - MODULE IMPRESSIONS → `home_module_impressions` (bucketed table, NOT
 *    events rows): every Home open × modules is the highest-cardinality
 *    signal in the app. The table dedupes server-side via a
 *    (user, module, hour) unique index; the client upserts with
 *    ignoreDuplicates AND keeps an in-memory seen-set so a scroll session
 *    costs at most one request per module per hour.
 *  - CLICKS + CONTENT VIEWS (`home_module_click`, `post_impression`,
 *    `product_view`) → regular `events` rows via trackDbEvent (low/medium
 *    volume), session-deduped client-side.
 *
 * Every reader of these numbers ("every number must be real") lives in the
 * DB, so GA4 is deliberately not involved (it's disabled on native anyway).
 */

// One entry per (module|content) per session — survives re-renders, resets on
// full reload. Impressions also dedupe server-side per hour; this just avoids
// pointless network chatter.
const seenThisSession = new Set<string>()

function sessionKey(kind: string, id: string): string {
  return `${kind}:${id}`
}

export function recordModuleImpression(moduleId: string, position: number): void {
  const { user, profile } = useAuthStore.getState()
  if (!user) return
  const key = sessionKey('module', moduleId)
  if (seenThisSession.has(key)) return
  seenThisSession.add(key)

  void supabase
    .from('home_module_impressions')
    .upsert(
      { user_id: user.id, module_id: moduleId, position, role: profile?.role ?? null },
      { onConflict: 'user_id,module_id,hour_bucket', ignoreDuplicates: true },
    )
    .then(({ error }) => {
      if (error) logger.debug('[home-instrumentation] impression skipped', error.message)
    })
}

export function trackModuleClick(moduleId: string, position: number): void {
  trackDbEvent('home_module_click', 'home_module', undefined, { module_id: moduleId, position })
}

/** Viewer country rides in properties as the profile's nationality country id
 *  (joins cleanly server-side; events has no country column). */
function viewerCountryId(): number | null {
  const { profile } = useAuthStore.getState()
  return (profile as { nationality_country_id?: number | null } | null)?.nationality_country_id ?? null
}

export function recordPostImpression(postId: string): void {
  const key = sessionKey('post', postId)
  if (seenThisSession.has(key)) return
  seenThisSession.add(key)
  const country = viewerCountryId()
  trackDbEvent('post_impression', 'post', postId, country != null ? { country_id: country } : undefined)
}

export function recordProductView(productId: string, brandId: string): void {
  const key = sessionKey('product', productId)
  if (seenThisSession.has(key)) return
  seenThisSession.add(key)
  const country = viewerCountryId()
  trackDbEvent('product_view', 'brand_product', productId, {
    brand_id: brandId,
    ...(country != null ? { country_id: country } : {}),
  })
}

/**
 * Fire `onVisible` exactly once when the element first approaches the
 * viewport (200px margin, house pattern). A card that renders but is never
 * scrolled to is NOT an impression.
 */
export function useImpressionOnce(onVisible: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const firedRef = useRef(false)
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible

  useEffect(() => {
    const el = ref.current
    if (!el || firedRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !firedRef.current) {
          firedRef.current = true
          observer.disconnect()
          onVisibleRef.current()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}
