import { memo } from 'react'
import * as Sentry from '@sentry/react'
import type { PulseItem } from '@/hooks/useMyPulse'
import { SnapshotGainCelebrationCard } from './SnapshotGainCelebrationCard'

/**
 * PulseCard — type-aware dispatcher for the v5-plan Movement Layer.
 *
 * Each `item.item_type` value maps to a specific card component. Unknown
 * types (e.g. backend ships a new card type before the frontend) are
 * reported once-per-session to Sentry and rendered as null, matching the
 * HomeFeedItemCard pattern.
 *
 * Phase 1B.3 lights up the first card type: snapshot_gain_celebration.
 * Subsequent phases register P1/P2/CL2 here.
 */

interface PulseCardProps {
  item: PulseItem
  onClick: (id: string) => void
  onDismiss: (id: string) => void
}

// The known-types set + isKnownPulseItemType helper live in
// `./pulseItemTypes` so this .tsx file only exports a component (Vite
// react-refresh rule). The switch below is the canonical dispatcher;
// keep `pulseItemTypes.ts` in sync when adding new card types.

// Module-level set so we only report each unknown item_type once per session.
// Same rate-limit pattern as HomeFeedItemCard — Sentry budget is precious.
const reportedUnknownTypes = new Set<string>()

export const PulseCard = memo(function PulseCard({ item, onClick, onDismiss }: PulseCardProps) {
  switch (item.item_type) {
    case 'snapshot_gain_celebration':
      return <SnapshotGainCelebrationCard item={item} onClick={onClick} onDismiss={onDismiss} />

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
