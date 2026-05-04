import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useMyPulse } from '@/hooks/useMyPulse'
import { PulseCard } from './PulseCard'
import { isKnownPulseItemType } from './pulseItemTypes'

/**
 * PulseSection — "Since you last visited" surface for the v5-plan Movement
 * Layer.
 *
 * Mounts at the top of the home feed (above ProfileCompletionCard).
 * Renders the user's active pulse items as cards via the PulseCard
 * dispatcher. Marks all unseen items as seen on first render.
 *
 * Phase 1B.3 ships the first card type (snapshot_gain_celebration) so the
 * "All caught up" empty state is now safe — without any generators it
 * would have implied the feature was broken. We still hide the entire
 * section when isLoading to avoid a flash of empty content on mount.
 */
export function PulseSection() {
  const { items, isLoading, markSeen, markClicked, markDismissed } = useMyPulse()

  // Track whether this mount ever showed at least one item. Without this,
  // a user who never has Pulse activity would see "All caught up" all the
  // time — visual noise that implies a feature they don't use. We only
  // surface the empty state once cards have been present and then cleared
  // (dismissed / actioned) within the same session.
  const hadItemsRef = useRef(false)
  const [hadItemsThisMount, setHadItemsThisMount] = useState(false)

  useEffect(() => {
    if (items.length > 0 && !hadItemsRef.current) {
      hadItemsRef.current = true
      setHadItemsThisMount(true)
    }
  }, [items.length])

  // Mark all currently-unseen items as seen exactly once. We compute the
  // unseen ID set from items every render but only fire the RPC when the
  // join-key changes, so this is O(items) per state change rather than
  // every render.
  //
  // Skip items whose type the dispatcher doesn't recognise — without this
  // guard, a future SQL signal that ships before frontend support would
  // be marked seen here and then sit in the user's feed forever (the row
  // is invisible because PulseCard renders null, and the user can never
  // dismiss what they can't see). The dispatcher still fires its
  // once-per-session Sentry warning so we know about the drift.
  const unseenIdsKey = useMemo(
    () =>
      items
        .filter((item) => !item.seen_at && isKnownPulseItemType(item.item_type))
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
  if (items.length === 0 && !hadItemsThisMount) return null

  return (
    <section className="mb-6" aria-label="Pulse — what changed since your last visit">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Since you last visited</h2>
      </header>
      {items.length === 0 ? (
        <div
          className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm"
          data-testid="pulse-empty-state"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" aria-hidden="true" />
          <span>You're all caught up.</span>
        </div>
      ) : (
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
      )}
    </section>
  )
}
