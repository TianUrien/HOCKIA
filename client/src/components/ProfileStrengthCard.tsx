import { useState } from 'react'
import { CheckCircle2, Circle, ChevronDown, ChevronUp, ChevronRight, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type BucketLike = {
  id: string
  label: string
  completed: boolean
  /** Optional honest value line shown beneath the label for incomplete buckets */
  unlockCopy?: string
}

interface ProfileStrengthCardProps<TBucket extends BucketLike = BucketLike> {
  /** Completion percentage (0-100) */
  percentage: number
  /** List of completion buckets */
  buckets: TBucket[]
  /** Whether data is loading */
  loading?: boolean
  /** Callback when a bucket action is clicked */
  onBucketAction?: (bucket: TBucket) => void
  /**
   * When true, renders the inline "Next step" CTA below the header.
   * Set to false when a NextStepCard is rendered elsewhere on the page
   * (e.g. above the tab strip) to avoid duplicating the same prompt.
   * Defaults to true for backward compatibility.
   */
  showNextStep?: boolean
}

/**
 * Get the color class for the progress bar based on percentage.
 */
function getProgressColor(percentage: number): string {
  if (percentage >= 100) return 'bg-emerald-500'
  if (percentage >= 75) return 'bg-emerald-400'
  if (percentage >= 50) return 'bg-amber-400'
  if (percentage >= 25) return 'bg-orange-400'
  return 'bg-red-400'
}

/**
 * ProfileStrengthCard - Compact, expandable profile completion indicator.
 *
 * Collapsed: Shows progress bar, percentage, step count, plus a "Complete next step"
 * CTA that deep-links directly into the top incomplete bucket's action.
 * Expanded: Shows full clickable checklist with unlock copy under each incomplete item.
 */
export default function ProfileStrengthCard<TBucket extends BucketLike>({
  percentage,
  buckets,
  loading = false,
  onBucketAction,
  showNextStep = true,
}: ProfileStrengthCardProps<TBucket>) {
  const [isExpanded, setIsExpanded] = useState(false)
  const completedCount = buckets.filter(b => b.completed).length
  const isComplete = percentage >= 100
  // Top incomplete bucket in the order defined by the hook — the "next step" the user is asked to take.
  const nextBucket = buckets.find(b => !b.completed)

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 animate-pulse">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-28 mb-2" />
            <div className="h-1.5 bg-gray-100 rounded-full w-full" />
          </div>
          <div className="h-4 bg-gray-200 rounded w-16" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* Collapsed Header - Always visible */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Title + Progress bar */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-sm font-semibold text-gray-900">Profile strength</h3>
              <span className={cn(
                "text-sm font-bold tabular-nums",
                isComplete ? "text-emerald-600" : "text-gray-700"
              )}>
                {percentage}%
              </span>
            </div>

            {/* Progress Bar - Thin and modern */}
            <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out",
                  getProgressColor(percentage)
                )}
                style={{ width: `${percentage}%` }}
              />
            </div>

            {/* Step count */}
            <p className="text-xs text-gray-500 mt-1.5">
              {completedCount} of {buckets.length} steps completed
            </p>
          </div>

          {/* Right: Toggle button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs font-medium text-[#8026FA] hover:text-[#6B20D4] transition-colors flex-shrink-0"
          >
            {isExpanded ? (
              <>
                Hide
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Details
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Next step CTA - shown only when there's an incomplete bucket and no external NextStepCard is rendering the same prompt */}
      {showNextStep && nextBucket && onBucketAction && (
        <button
          type="button"
          onClick={() => onBucketAction(nextBucket)}
          className="w-full flex items-start gap-3 px-4 py-3 border-t border-gray-100 bg-[#8026FA]/[0.03] hover:bg-[#8026FA]/[0.06] text-left transition-colors group"
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#8026FA] mb-0.5">
              Next step
            </p>
            <p className="text-sm font-medium text-gray-900 truncate">
              {nextBucket.label}
            </p>
            {nextBucket.unlockCopy && (
              <p className="text-xs text-gray-600 mt-0.5 leading-snug">
                {nextBucket.unlockCopy}
              </p>
            )}
          </div>
          <ArrowRight className="w-4 h-4 mt-0.5 text-[#8026FA] flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      {/* Expanded Details - Animated dropdown */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3 pt-1 border-t border-gray-100">
            <ul className="space-y-1">
              {buckets.map(bucket => (
                <li key={bucket.id}>
                  {bucket.completed ? (
                    <div className="flex items-center gap-2.5 py-1.5 text-sm text-emerald-600">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{bucket.label}</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => onBucketAction?.(bucket)}
                      className="w-full flex items-start gap-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors group text-left"
                    >
                      <Circle className="w-4 h-4 flex-shrink-0 text-gray-300 mt-0.5" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{bucket.label}</span>
                        {bucket.unlockCopy && (
                          <span className="block text-xs text-gray-500 mt-0.5 leading-snug">
                            {bucket.unlockCopy}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
