import { CheckCircle2, Circle, Info } from 'lucide-react'
import TierBadge from './TierBadge'
import { calculateTier, type ProfileTier } from '@/lib/profileTier'

type BucketLike = {
  id: string
  label: string
  /** Optional noun-phrase form of the bucket name (e.g. "trusted
   *  references"). Used in the comparative copy where the imperative
   *  `label` ("Get a trusted reference") would read awkwardly. Falls
   *  back to label.toLowerCase() when not provided. */
  noun?: string
  completed: boolean
}

interface ProfileHealthCardProps<TBucket extends BucketLike = BucketLike> {
  /** Completion percentage (0-100). */
  percentage: number
  /** Bucket completion status (full set, in display order). */
  buckets: TBucket[]
  /** Hide the card entirely while data is loading. */
  loading?: boolean
}

/**
 * ProfileHealthCard — diagnostic counterpart to NextStepCard.
 *
 * Where NextStepCard gives a single gamified "next step" CTA, this card
 * shows the FULL picture: which signals recruiters look for are present,
 * which are missing, and a neutral comparative line about why complete
 * profiles tend to get more recruiter contact.
 *
 * Owner-only. Reuses the same useProfileStrength buckets the dashboard
 * already computes — no extra queries.
 *
 * Comparative copy is intentionally neutral. We do NOT make
 * "X× more contacted" claims until we have profile_search_appearances
 * + profile_views + recruiter-conversion data with statistically honest
 * sample sizes. Inventing multipliers would erode trust the moment a
 * recruiter screenshots and questions the figure.
 */
export default function ProfileHealthCard<TBucket extends BucketLike>({
  percentage,
  buckets,
  loading = false,
}: ProfileHealthCardProps<TBucket>) {
  if (loading) return null
  if (buckets.length === 0) return null

  const tier: ProfileTier = calculateTier(percentage)
  const completed = buckets.filter((b) => b.completed)
  const missing = buckets.filter((b) => !b.completed)
  const isComplete = missing.length === 0

  // Tailor the comparative copy to which high-signal buckets are missing.
  // Names of the three highest-recruiter-value buckets in the player set.
  const RECRUITER_SIGNAL_IDS = new Set(['highlight-video', 'full-match-footage', 'references'])
  const missingHighSignal = missing.filter((b) => RECRUITER_SIGNAL_IDS.has(b.id))

  const comparativeCopy = (() => {
    if (isComplete) {
      return 'Your profile has the signals recruiters look for. Keep it fresh — clubs see updated profiles first.'
    }
    if (missingHighSignal.length === 0) {
      // Recruiter-grade signals all present, only smaller items missing.
      return 'You have the high-impact signals recruiters look for. Filling the remaining items rounds out your profile.'
    }
    if (missingHighSignal.length === 1) {
      // Prefer the bucket's `noun` (e.g. "trusted references") over the
      // imperative `label` ("Get a trusted reference"). Without the noun
      // fallback the line reads "Profiles with get a trusted reference
      // tend to..." — caught in staging QA on Batch 4.
      const phrase = missingHighSignal[0].noun ?? missingHighSignal[0].label.toLowerCase()
      return `Profiles with ${phrase} tend to get more recruiter contact.`
    }
    // Multiple high-signal items missing — keep it general rather than naming all.
    return 'Profiles with full match footage, highlight video, and trusted references tend to get more recruiter contact.'
  })()

  // Pair buckets into rows of 2 for the diagnostic grid. We render via CSS
  // grid (not chunked) so the columns auto-balance — it just looks like
  // "checklist" instead of a paragraph.
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
      {/* Header: tier badge + percentage */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Profile health</h3>
          <TierBadge tier={tier} size="sm" />
        </div>
        <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">
          {percentage}%
        </span>
      </div>

      {/* Diagnostic grid — completed first, missing second; 2-column on >=sm */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-4">
        {completed.map((b) => (
          <li
            key={b.id}
            className="flex items-start gap-2 text-sm text-gray-700"
          >
            <CheckCircle2
              className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span className="min-w-0">{b.label}</span>
          </li>
        ))}
        {missing.map((b) => (
          <li
            key={b.id}
            className="flex items-start gap-2 text-sm text-gray-500"
          >
            <Circle
              className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span className="min-w-0">{b.label}</span>
          </li>
        ))}
      </ul>

      {/* Footer: neutral comparative copy in a subtle info row */}
      <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-600 leading-relaxed">
        <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <span>{comparativeCopy}</span>
      </div>
    </div>
  )
}
