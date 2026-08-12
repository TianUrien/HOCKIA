import { logger } from './logger'

/**
 * Delete service-worker caches that must never hold user-scoped API data.
 *
 * Removing the runtime-caching RULE (vite.config.ts, 2026-08-08) stops NEW
 * entries, but every device that already installed the old service worker
 * still carries a populated `supabase-api-cache` — potentially containing the
 * previous account's rows, keyed by URL only and surviving sign-out. Those
 * devices only shed it when the browser evicts storage, which may be never.
 *
 * So we delete it explicitly: once at startup (clears the installed base on
 * next visit) and again on sign-out (so nothing user-scoped outlives a
 * session, including any cache a future rule might add).
 *
 * Safe to call anywhere: no-ops when Cache Storage is unavailable (SSR, the
 * prerender pass, older WebViews) and never throws.
 */

/** Caches that may contain user-scoped responses. Asset/font caches are safe. */
const USER_SCOPED_CACHES = ['supabase-api-cache']

export async function purgeStaleApiCaches(reason: string): Promise<void> {
  try {
    if (typeof caches === 'undefined') return

    const names = await caches.keys()
    const doomed = names.filter(
      (n) => USER_SCOPED_CACHES.includes(n) || /supabase|api-cache/i.test(n),
    )
    if (doomed.length === 0) return

    await Promise.all(doomed.map((n) => caches.delete(n).catch(() => false)))
    logger.info('[cache] purged user-scoped SW caches', { reason, caches: doomed })
  } catch (err) {
    // Never let cache hygiene break sign-out or app boot.
    logger.debug('[cache] purge skipped', { reason, err })
  }
}
