import {
  Building2,
  Briefcase,
  ChevronRight,
  GraduationCap,
  HelpCircle,
  MapPin,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import type { SuggestedAction } from '@/hooks/useDiscover'

interface ActionChipRowProps {
  actions: SuggestedAction[]
  onAction: (action: SuggestedAction) => void
  /** When true, render chips as a compact horizontal row (default). When false,
   *  wrap onto multiple lines if needed. */
  compact?: boolean
}

/**
 * Pick a small icon for each chip based on its label. Pure label-pattern match —
 * keeps the icon → chip mapping co-located here so adding a chip is a one-line
 * change in the suggested-actions catalog.
 */
function iconFor(label: string): LucideIcon {
  const l = label.toLowerCase()
  if (l.includes('show all') || l.startsWith('show ')) return Users
  if (l.includes('country')) return MapPin
  if (l.includes('remove') || l.includes('without')) return X
  // Phase 4 audit P3-1: was includes('opportunit') — fragile substring that
  // could silently match unrelated typo'd labels. Match the actual word forms
  // we ship in the catalog.
  if (l.includes('opportunity') || l.includes('opportunities')) return Briefcase
  if (l.includes('marketplace')) return ShoppingBag
  if (l.includes('improve') || l.includes("what's missing")) return Sparkles
  if (l.includes('club')) return Building2
  if (l.includes('coach')) return GraduationCap
  if (l.includes('player') || l.includes('ambassador') || l.includes('staff')) return UserPlus
  if (l.includes('retry')) return RotateCcw
  if (l.includes('start over') || l.includes('clear')) return Trash2
  if (l.includes('broaden') || l.includes('widen')) return ZoomOut
  if (l.includes('what can you do')) return HelpCircle
  return ChevronRight
}

export default function ActionChipRow({ actions, onAction, compact = false }: ActionChipRowProps) {
  if (!actions || actions.length === 0) return null

  return (
    <div
      className={
        compact
          ? 'mt-3 flex flex-wrap gap-2'
          : 'mt-3.5 flex flex-wrap gap-2'
      }
      role="group"
      aria-label="Suggested next actions"
    >
      {actions.map((action, idx) => {
        const Icon = iconFor(action.label)
        return (
          <button
            key={`${action.label}-${idx}`}
            type="button"
            onClick={() => onAction(action)}
            className="
              inline-flex items-center gap-1.5
              min-h-[36px] px-3.5 py-2
              rounded-full
              border border-gray-200 bg-white
              text-xs font-medium text-gray-700
              hover:border-hockia-primary/40 hover:bg-hockia-primary/[0.06] hover:text-hockia-primary
              active:scale-[0.98] active:bg-hockia-primary/10
              transition-all duration-150
              focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40 focus-visible:border-hockia-primary/40
            "
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            <span className="leading-none">{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}
