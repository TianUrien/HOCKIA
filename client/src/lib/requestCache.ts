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
      logger.debug(`[Cache] HIT: ${key}`);
      return cached.data as T;
    }

    // Check if request is already in flight
    const existing = this.inFlight.get(key);
    if (existing && Date.now() - existing.timestamp < this.DEDUP_WINDOW) {
      logger.debug(`[Dedupe] Request already in flight: ${key}`);
      return existing.promise as Promise<T>;
    }

    // Execute new request
    logger.debug(`[Dedupe] New request: ${key}`);
    const promise = fn()
      .then((data) => {
        // Cache successful results
        this.cache.set(key, { data, timestamp: Date.now() });
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

