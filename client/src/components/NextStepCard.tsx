import { ArrowRight, Sparkles } from 'lucide-react'

type BucketLike = {
  id: string
  label: string
  completed: boolean
  /** Optional honest value line shown beneath the label */
  unlockCopy?: string
}

interface NextStepCardProps<TBucket extends BucketLike = BucketLike> {
  /** Completion percentage (0-100) */
  percentage: number
  /** List of completion buckets */
  buckets: TBucket[]
  /** Whether data is loading */
  loading?: boolean
  /** Called when the CTA is tapped with the top incomplete bucket */
  onBucketAction?: (bucket: TBucket) => void
}

/**
 * NextStepCard — a prominent, above-the-fold prompt that surfaces the single
 * most impactful missing profile field and deep-links the user straight to it.
 *
 * Hidden automatically while loading, when the profile is already 100%, or
 * when there is no incomplete bucket (e.g. empty hook state).
 *
 * Reuses the per-role profile strength hook (`useProfileStrength`,
 * `useCoachProfileStrength`, etc.) so the CTA stays in sync with the
 * detailed `ProfileStrengthCard` lower down the page.
 */
export default function NextStepCard<TBucket extends BucketLike>({
  percentage,
  buckets,
  loading = false,
  onBucketAction,
}: NextStepCardProps<TBucket>) {
  if (loading) return null
  if (percentage >= 100) return null

  const nextBucket = buckets.find(b => !b.completed)
  if (!nextBucket) return null

  const completedCount = buckets.filter(b => b.completed).length
  const remaining = buckets.length - completedCount

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#8026FA]/15 bg-gradient-to-br from-[#8026FA]/[0.06] via-white to-[#ec4899]/[0.05] p-5 md:p-6 shadow-sm">
      {/* Decorative corner accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-[#8026FA]/10 to-[#ec4899]/10 blur-2xl"
      />

      <div className="relative">
        {/* Progress summary */}
        <div className="mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-semibold text-gray-900">Your profile</p>
            <p className="text-sm font-bold text-[#8026FA] tabular-nums">
              {percentage}%
            </p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-inset ring-[#8026FA]/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#8026FA] to-[#ec4899] transition-all duration-500 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            {remaining} step{remaining === 1 ? '' : 's'} left to complete
          </p>
        </div>

        {/* Next step CTA body */}
        <div className="flex items-start gap-3 md:gap-4">
          <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-[#8026FA] to-[#ec4899] text-white shadow-sm">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8026FA] mb-0.5">
              Next step
            </p>
            <h3 className="text-base font-semibold text-gray-900 leading-snug">
              {nextBucket.label}
            </h3>
            {nextBucket.unlockCopy && (
              <p className="text-sm text-gray-600 leading-relaxed mt-1">
                {nextBucket.unlockCopy}
              </p>
            )}
            <button
              type="button"
              onClick={() => onBucketAction?.(nextBucket)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white px-4 py-2 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity"
            >
              Get started
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
