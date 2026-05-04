import { memo } from 'react'
import * as Sentry from '@sentry/react'
import type { PulseItem } from '@/hooks/useMyPulse'

/**
 * PulseCard — type-aware dispatcher for the v5-plan Movement Layer.
 *
 * Each `item.item_type` value maps to a specific card component (added in
 * 1B.3+). Unknown types (e.g. backend ships a new card type before the
 * frontend) are reported once-per-session to Sentry and rendered as null,
 * matching the HomeFeedItemCard pattern.
 *
 * Phase 1B.2 ships the dispatcher with NO card types registered. Every
 * item flows through the default branch and renders nothing. The
 * PulseSection that mounts these cards therefore renders nothing for
 * everyone too — no surface visible to users until 1B.3 lights up the
 * first card type. This is intentional: building the empty pipeline
 * separately from the first card lets us validate the surface, hook,
 * RPCs, and analytics independently.
 */

interface PulseCardProps {
  item: PulseItem
  onClick: (id: string) => void
  onDismiss: (id: string) => void
}

// Module-level set so we only report each unknown item_type once per session.
// Same rate-limit pattern as HomeFeedItemCard — Sentry budget is precious.
const reportedUnknownTypes = new Set<string>()

export const PulseCard = memo(function PulseCard({ item, onClick: _onClick, onDismiss: _onDismiss }: PulseCardProps) {
  // Mark unused props as deliberately referenced — they'll wire up once
  // card types start consuming them in 1B.3+.
  void _onClick
  void _onDismiss

  switch (item.item_type) {
    // No card types registered yet. The first one (Snapshot Gain
    // Celebration — P6) ships in 1B.3.

    default: {
      const unknownType = item.item_type
      if (!reportedUnknownTypes.has(unknownType)) {
        reportedUnknownTypes.add(unknownType)
        Sentry.captureMessage('pulse.unknown_item_type', {
          level: 'warning',
          tags: { feature: 'pulse', item_type: unknownType },
          extra: { pulse_id: item.id },
        })
      }
      return null
    }
  }
})
