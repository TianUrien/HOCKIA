/**
 * Service-worker cache hygiene — security regression guard.
 *
 * The SW used to cache every `/rest/v1/` response into `supabase-api-cache`.
 * Cache Storage keys on URL ALONE — the Authorization header is not part of
 * the key — so those user-scoped rows could be served to the next person on a
 * shared device, and they survived sign-out entirely. The caching rule was
 * removed (vite.config.ts, 2026-08-08); this purge clears whatever is already
 * sitting on devices that installed the older service worker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { purgeStaleApiCaches } from '@/lib/purgeStaleApiCaches'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const originalCaches = (globalThis as { caches?: CacheStorage }).caches

function mockCaches(names: string[], onDelete?: (n: string) => boolean | Promise<boolean>) {
  const deleted: string[] = []
  ;(globalThis as unknown as { caches: unknown }).caches = {
    keys: async () => names,
    delete: async (n: string) => {
      deleted.push(n)
      return onDelete ? onDelete(n) : true
    },
  }
  return deleted
}

afterEach(() => {
  if (originalCaches === undefined) {
    delete (globalThis as { caches?: CacheStorage }).caches
  } else {
    ;(globalThis as { caches?: CacheStorage }).caches = originalCaches
  }
})

describe('purgeStaleApiCaches', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the user-scoped API cache', async () => {
    const deleted = mockCaches(['supabase-api-cache', 'images-cache', 'lazy-assets'])
    await purgeStaleApiCaches('test')
    expect(deleted).toContain('supabase-api-cache')
  })

  it('does NOT delete asset caches (they hold nothing user-scoped)', async () => {
    const deleted = mockCaches(['supabase-api-cache', 'images-cache', 'lazy-assets', 'google-fonts'])
    await purgeStaleApiCaches('test')
    expect(deleted).not.toContain('images-cache')
    expect(deleted).not.toContain('lazy-assets')
    expect(deleted).not.toContain('google-fonts')
  })

  it('also catches differently-named api caches from older builds', async () => {
    const deleted = mockCaches(['supabase-rest-cache-v2', 'my-api-cache', 'images-cache'])
    await purgeStaleApiCaches('test')
    expect(deleted).toEqual(expect.arrayContaining(['supabase-rest-cache-v2', 'my-api-cache']))
    expect(deleted).not.toContain('images-cache')
  })

  it('no-ops when Cache Storage is unavailable (SSR / prerender / old WebView)', async () => {
    delete (globalThis as { caches?: CacheStorage }).caches
    await expect(purgeStaleApiCaches('test')).resolves.toBeUndefined()
  })

  it('never throws when a delete fails — must not break sign-out', async () => {
    ;(globalThis as unknown as { caches: unknown }).caches = {
      keys: async () => ['supabase-api-cache'],
      delete: async () => { throw new Error('storage unavailable') },
    }
    await expect(purgeStaleApiCaches('sign-out')).resolves.toBeUndefined()
  })

  it('never throws when keys() itself fails', async () => {
    ;(globalThis as unknown as { caches: unknown }).caches = {
      keys: async () => { throw new Error('boom') },
      delete: async () => true,
    }
    await expect(purgeStaleApiCaches('startup')).resolves.toBeUndefined()
  })
})
