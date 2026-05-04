import { useEffect, useMemo } from 'react'
import { useMyPulse } from '@/hooks/useMyPulse'
import { PulseCard } from './PulseCard'

/**
 * PulseSection — "Since you last visited" surface for the v5-plan Movement
 * Layer.
 *
 * Mounts at the top of the home feed (above ProfileCompletionCard).
 * Renders the user's active pulse items as cards via the PulseCard
 * dispatcher. Marks all unseen items as seen on first render.
 *
 * Behavior in Phase 1B.2 (no card types registered yet):
 *   - PulseCard returns null for every item_type → nothing visible.
 *   - When card types ship in 1B.3+, this section lights up automatically.
 *   - When 0 active items exist, returns null (no "All caught up" empty
 *     state in 1B.2 — adding it before any card type would mislead users
 *     into thinking the feature is broken / dead. We add the empty state
 *     in 1B.3 alongside the first real card type).
 */
export function PulseSection() {
  const { items, isLoading, markSeen, markClicked, markDismissed } = useMyPulse()

  // Mark all currently-unseen items as seen exactly once. We compute the
  // unseen ID set from items every render but only fire the RPC when the
  // join-key changes, so this is O(items) per state change rather than
  // every render.
  const unseenIdsKey = useMemo(
    () =>
      items
        .filter((item) => !item.seen_at)
        .map((item) => item.id)
        .join(','),
    [items],
  )

  useEffect(() => {
    if (isLoading) return
    if (!unseenIdsKey) return
    void markSeen(unseenIdsKey.split(','))
  }, [isLoading, unseenIdsKey, markSeen])

  if (isLoading) return null
  if (items.length === 0) return null

  return (
    <section className="mb-6" aria-label="Pulse — what changed since your last visit">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Since you last visited</h2>
      </header>
      <div className="space-y-3">
        {items.map((item) => (
          <PulseCard
            key={item.id}
            item={item}
            onClick={markClicked}
            onDismiss={markDismissed}
          />
        ))}
      </div>
    </section>
  )
}
