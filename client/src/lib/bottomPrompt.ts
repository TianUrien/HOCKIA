import { useEffect, useReducer } from 'react'

/**
 * Coordinates the fixed bottom-corner prompts (Install / Push / Native update /
 * App rating). Each prompt registers whether it's currently visible; the
 * lowest-priority one (the rating card) reads `otherActive` and defers while any
 * other is showing — so the rating card never stacks on the others. The other three
 * keep their own existing guards between themselves (Install hides inside the native
 * app, Push defers to Install via the pwa-install-visible flag, a force-update is a
 * blocking modal). In-memory + subscription based, so it's reactive within the same
 * tab (unlike a localStorage flag).
 */
const active = new Set<string>()
const listeners = new Set<() => void>()

function setActive(id: string, isActive: boolean): void {
  const had = active.has(id)
  if (isActive && !had) {
    active.add(id)
    listeners.forEach((l) => l())
  } else if (!isActive && had) {
    active.delete(id)
    listeners.forEach((l) => l())
  }
}

function isOtherActive(selfId: string): boolean {
  for (const id of active) if (id !== selfId) return true
  return false
}

/**
 * Register this prompt's visibility and learn whether another bottom prompt is
 * showing. Returns `otherActive` (true if a *different* prompt currently holds a
 * slot). Higher-priority prompts can ignore the return value; the rating card
 * uses it to defer.
 */
export function useBottomPrompt(id: string, visible: boolean): boolean {
  const [, rerender] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    listeners.add(rerender)
    return () => {
      listeners.delete(rerender)
    }
  }, [])

  useEffect(() => {
    setActive(id, visible)
    return () => setActive(id, false)
  }, [id, visible])

  return isOtherActive(id)
}
