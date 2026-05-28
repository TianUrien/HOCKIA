/**
 * Request Deduplication & Caching
 * Prevents duplicate API calls for the same data within a short time window
 */

import { logger } from './logger'

interface InFlightRequest {
  promise: Promise<unknown>;
  timestamp: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class RequestCache {
  private inFlight = new Map<string, InFlightRequest>();
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly DEDUP_WINDOW = 5000; // 5 seconds
  private readonly CACHE_TTL = 30000; // 30 seconds

  /**
   * Diagnostic — opt-in console logging for HIT/MISS/IN_FLIGHT decisions.
   * Enable in a browser session via:
   *   localStorage.setItem('__hockia_cache_debug__', '1')
   * Disable with:
   *   localStorage.removeItem('__hockia_cache_debug__')
   *
   * Gated so production users never see the spam unless they opt in.
   * Used to diagnose why Bento card dedupe appears to miss across SPA
   * navigation in production builds (staging QA pass on 8ee75aa).
   */
  private isDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem('__hockia_cache_debug__') === '1'
    } catch {
      return false
    }
  }

  private debugLog(
    event: 'HIT' | 'MISS' | 'IN_FLIGHT' | 'STORE',
    key: string,
    meta?: Record<string, unknown>,
  ): void {
    if (!this.isDebugEnabled()) return
    console.info(`[Cache] ${event}`, { key, ...meta })
  }

  /**
   * Read-only snapshot of all currently cached keys + their age.
   * Exposed on window.__HOCKIA_REQUEST_CACHE__ for one-shot inspection
   * during the diagnostic pass. Never modifies state.
   */
  inspect(): Array<{ key: string; ageMs: number; ttl: number; hasInflight: boolean }> {
    const now = Date.now()
    const keys = new Set<string>([...this.cache.keys(), ...this.inFlight.keys()])
    return Array.from(keys).map((key) => {
      const entry = this.cache.get(key)
      return {
        key,
        ageMs: entry ? now - entry.timestamp : -1,
        ttl: this.CACHE_TTL,
        hasInflight: this.inFlight.has(key),
      }
    })
  }

  /**
   * Deduplicates requests - if same request is in flight, returns existing promise
   * If data is cached and fresh, returns cached data
   */
  async dedupe<T>(
    key: string,
    fn: () => Promise<T>,
    cacheTTL?: number
  ): Promise<T> {
    const ttl = cacheTTL ?? this.CACHE_TTL;

    // Check cache first
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
      const ageMs = Date.now() - cached.timestamp
      this.debugLog('HIT', key, { ageMs, ttl })
      logger.debug(`[Cache] HIT: ${key}`);
      return cached.data as T;
    }

    // Check if request is already in flight
    const existing = this.inFlight.get(key);
    if (existing && Date.now() - existing.timestamp < this.DEDUP_WINDOW) {
      this.debugLog('IN_FLIGHT', key)
      logger.debug(`[Dedupe] Request already in flight: ${key}`);
      return existing.promise as Promise<T>;
    }

    // Execute new request — record WHY it's a miss (no cached entry vs
    // stale entry past TTL) so the diagnostic can tell the two apart.
    const missReason = cached
      ? `stale (age ${Date.now() - cached.timestamp}ms > ttl ${ttl}ms)`
      : 'no cache entry'
    this.debugLog('MISS', key, { reason: missReason, ttl })
    logger.debug(`[Dedupe] New request: ${key}`);
    const promise = fn()
      .then((data) => {
        // Cache successful results
        this.cache.set(key, { data, timestamp: Date.now() });
        this.debugLog('STORE', key)
        return data;
      })
      .finally(() => {
        // Clean up in-flight tracking
        this.inFlight.delete(key);
      });

    // Track in-flight request
    this.inFlight.set(key, { promise, timestamp: Date.now() });

    return promise;
  }

  /**
   * Synchronously check whether a cached value exists and is still
   * within its TTL. Returns the value or undefined. Use this to
   * short-circuit setState chains (e.g. avoid flashing a spinner on
   * a re-mount where the data is already cached). Does NOT trigger
   * the fn — purely a read.
   */
  peek<T>(key: string, cacheTTL?: number): T | undefined {
    const ttl = cacheTTL ?? this.CACHE_TTL
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data as T
    }
    return undefined
  }

  /**
   * Invalidate cache for a specific key or pattern
   */
  invalidate(keyOrPattern: string | RegExp) {
    if (typeof keyOrPattern === 'string') {
      this.cache.delete(keyOrPattern);
      this.inFlight.delete(keyOrPattern);
    } else {
      // Pattern-based invalidation
      for (const key of this.cache.keys()) {
        if (keyOrPattern.test(key)) {
          this.cache.delete(key);
          this.inFlight.delete(key);
        }
      }
    }
  }

  /**
   * Clear all cache and in-flight requests
   */
  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      inFlightCount: this.inFlight.size,
    };
  }
}

export const requestCache = new RequestCache();

// Diagnostic — expose the singleton on window for one-shot inspection
// during the cache-dedup investigation. Read-only methods (inspect,
// getStats) are the intended use; existing mutators (clear, invalidate)
// were already reachable via module import. No new attack surface.
if (typeof window !== 'undefined') {
  (window as unknown as { __HOCKIA_REQUEST_CACHE__?: RequestCache }).__HOCKIA_REQUEST_CACHE__ =
    requestCache
}

/**
 * Helper function to generate cache keys
 */
export function generateCacheKey(
  resource: string,
  params?: Record<string, unknown>
): string {
  if (!params) return resource;
  
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join('&');
    
  return `${resource}?${sortedParams}`;
}

/**
 * Usage example:
 * 
 * const data = await requestCache.dedupe(
 *   generateCacheKey('profiles', { id: userId }),
 *   () => supabase.from('profiles').select('*').eq('id', userId).single()
 * );
 */

