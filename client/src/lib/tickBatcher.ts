/**
 * Collapse per-item reads made in the same tick into one read (the pattern of
 * lib/notifications.ts fetchActorProfile and hooks/useActivityPhotos, made
 * reusable). Home renders many cards that each ask for "their" row; without
 * this, a rail of 10 role cards is 10 identical requests (Sentry's
 * "N+1 API Call", JAVASCRIPT-REACT-D7 class).
 *
 * `load(key)` queues the key, dedupes it against reads already in flight, and
 * resolves with that key's value once the batched `fetchMany` returns. A key
 * the read did not return resolves to `undefined`; a failed read rejects every
 * waiter of that batch (callers keep their own fallback).
 */
export interface TickBatcher<V> {
  load(key: string): Promise<V | undefined>
}

export function createTickBatcher<V>(
  fetchMany: (keys: string[]) => Promise<Map<string, V>>,
  { max = 60, waitMs = 0 }: { max?: number; waitMs?: number } = {},
): TickBatcher<V> {
  type Waiter = { key: string; resolve: (v: V | undefined) => void; reject: (e: unknown) => void }
  const queue: Waiter[] = []
  const inFlight = new Map<string, Promise<V | undefined>>()
  let timer: ReturnType<typeof setTimeout> | null = null

  async function flush(): Promise<void> {
    timer = null
    const batch = queue.splice(0, max)
    if (queue.length > 0) timer = setTimeout(() => { void flush() }, 0)
    if (batch.length === 0) return
    const keys = Array.from(new Set(batch.map((w) => w.key)))
    try {
      const found = await fetchMany(keys)
      for (const w of batch) w.resolve(found.get(w.key))
    } catch (err) {
      for (const w of batch) w.reject(err)
    }
  }

  return {
    load(key: string) {
      const pending = inFlight.get(key)
      if (pending) return pending
      const promise = new Promise<V | undefined>((resolve, reject) => {
        queue.push({ key, resolve, reject })
        if (!timer) timer = setTimeout(() => { void flush() }, waitMs)
      }).finally(() => { inFlight.delete(key) })
      inFlight.set(key, promise)
      return promise
    },
  }
}
