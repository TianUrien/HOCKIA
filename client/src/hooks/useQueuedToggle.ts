import { useCallback, useRef, useState } from 'react'

/**
 * A switch that shows each tap at once and saves taps one after another, so
 * quick double taps never race: the value saved last is always the value on
 * screen (QA F4 2026-10-14 — two parallel saves both sent "on"). `save`
 * resolves false (or throws) on failure; the switch then falls back to the
 * server value and `onError` runs.
 */
export function useQueuedToggle(serverValue: boolean, save: (next: boolean) => Promise<boolean | void>, onError?: () => void) {
  const [desired, setDesired] = useState<boolean | null>(null)
  const pending = useRef<boolean | null>(null)
  const inFlight = useRef(false)
  const shown = desired ?? serverValue

  const flush = useCallback(async () => {
    inFlight.current = true
    let ok = true
    while (pending.current !== null) {
      const value = pending.current
      pending.current = null
      try {
        ok = (await save(value)) !== false
      } catch {
        ok = false
      }
      if (!ok) { pending.current = null; break }
    }
    inFlight.current = false
    setDesired(null)
    if (!ok) onError?.()
  }, [save, onError])

  const toggle = useCallback(() => {
    const next = !(desired ?? serverValue)
    setDesired(next)
    pending.current = next
    if (!inFlight.current) void flush()
  }, [desired, serverValue, flush])

  return { value: shown, toggle, saving: desired !== null }
}
