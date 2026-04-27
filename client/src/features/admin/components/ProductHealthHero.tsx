/**
 * ProductHealthHero
 *
 * Hero card on AdminOverview that answers "is HOCKIA actually working?"
 * in one number plus six core-loop sub-scores. Strict by design — passive
 * activity contributes near-zero. See migration 20260427150000 for the
 * full spec.
 */

import { useProductHealthScore } from '../hooks/useProductHealthScore'
import type { LoopName, ProductHealthScore, ProductHealthTier } from '../types/productHealth'
import { AlertCircle, Activity, RefreshCw } from 'lucide-react'

const TIER_CONFIG: Record<
  ProductHealthTier,
  { label: string; emoji: string; color: string; bg: string }
> = {
  critical:  { label: 'Critical',  emoji: '🔴', color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
  weak:      { label: 'Weak',      emoji: '🟠', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  building:  { label: 'Building',  emoji: '🟡', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  working:   { label: 'Working',   emoji: '🟢', color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
  excellent: { label: 'Excellent', emoji: '🌟', color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
}

const LOOP_LABELS: Record<LoopName, string> = {
  recruitment:  'Recruitment',
  network:      'Network',
  retention:    'Retention',
  role_balance: 'Role Balance',
  activation:   'Activation',
  content:      'Content',
}

/**
 * Builds a one-line "what's the bottleneck" sentence from the diagnostics.
 * Pure UI logic — RPC could surface this but keeping it client-side lets
 * us evolve copy without a migration.
 */
function buildBottleneckExplanation(score: ProductHealthScore): string {
  const { bottleneck, diagnostics } = score
  switch (bottleneck.loop) {
    case 'recruitment': {
      const r = diagnostics.recruitment
      if (r.opportunities_30d === 0) {
        return 'No opportunities posted in the last 30 days. The recruitment loop has no fuel.'
      }
      if (r.opportunities_with_apps === 0) {
        return `${r.opportunities_30d} opportunities posted but 0 received applications.`
      }
      if (r.applications_reviewed_30d === 0) {
        return `${r.applications_30d} applications received but clubs haven't reviewed any.`
      }
      const reviewRate = r.applications_30d > 0
        ? Math.round((r.applications_reviewed_30d / r.applications_30d) * 100)
        : 0
      return `Only ${reviewRate}% of applications are being reviewed. Tiers 5–6 (club messages → reply) deferred to Phase 2.`
    }
    case 'network': {
      const n = diagnostics.network
      if (n.reciprocal_cross_role_7d === 0) {
        return 'No cross-role reciprocal conversations this week. The network is quiet.'
      }
      if (n.references_accepted_30d === 0) {
        return 'No accepted references this month. The trust loop is not firing.'
      }
      return `${n.reciprocal_cross_role_7d} cross-role conversations reciprocated this week.`
    }
    case 'retention': {
      const r = diagnostics.retention
      if (!r.w1_cohort_known) {
        return 'Not enough recent signups for a W1 retention cohort yet.'
      }
      return `Meaningful W1 retention is ${r.meaningful_w1_pct}%; W4 is ${r.meaningful_w4_pct}%. Target: 30% / 15%.`
    }
    case 'role_balance': {
      const r = diagnostics.role_balance
      return `Lowest role contributes ${r.lowest_role_pct}% of high-value actions; cross-role interactions ${r.cross_role_interaction_pct}%.`
    }
    case 'activation': {
      const a = diagnostics.activation
      if (a.signups_30d === 0) return 'No new signups in the last 30 days.'
      const rate = a.activation_rate_pct ?? 0
      return `${a.activated_in_7d} of ${a.signups_30d} signups activated in 7 days (${rate}%). Target: 50%.`
    }
    case 'content': {
      const c = diagnostics.content
      if (c.low_data_confidence) {
        return 'Low data confidence — too few posts to score reliably.'
      }
      return `${c.posts_with_comment_pct}% of posts received a comment. Target: 30%.`
    }
  }
}

/**
 * Returns a one-liner "do this next" suggestion for the bottleneck loop.
 */
function buildNextActionSuggestion(score: ProductHealthScore): string {
  const { bottleneck, diagnostics } = score
  switch (bottleneck.loop) {
    case 'recruitment': {
      const r = diagnostics.recruitment
      if (r.opportunities_30d === 0) {
        return 'Reach out to clubs to post opportunities. Without supply on this side, no recruitment is possible.'
      }
      if (r.opportunities_with_view === 0) {
        return 'Investigate why opportunities aren\'t surfacing to matching players. Check Discovery search relevance and notification delivery for opportunity_published.'
      }
      if (r.opportunities_with_apps === 0) {
        return 'Opportunities are visible but nobody applies. Inspect the Apply CTA, filters, and matching logic.'
      }
      return 'Help clubs review applications faster. Add a notification or dashboard nudge for clubs with pending applications.'
    }
    case 'network':
      return 'Encourage cross-role conversations. Suggest "people you should connect with" surfacing players to clubs and vice versa.'
    case 'retention':
      return 'Find what brought returning users back and double down. Onboarding-completed-but-never-returned users are the cohort to investigate.'
    case 'role_balance':
      return 'Imbalance detected — one role is doing the heavy lifting. Recruit users on the missing side of the marketplace.'
    case 'activation':
      return 'Tighten the path from signup to first meaningful action. Check the empty-state CTAs for new users by role.'
    case 'content':
      return 'Content volume is too low to read. Not a priority bottleneck while Recruitment / Network are the real constraints.'
  }
}

export function ProductHealthHero() {
  const { score, isLoading, error, refetch } = useProductHealthScore()

  if (isLoading && !score) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse">
        <div className="h-4 w-48 bg-gray-200 rounded mb-3" />
        <div className="h-12 w-32 bg-gray-200 rounded mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-4 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !score) {
    return (
      <div className="bg-white rounded-2xl border border-red-200 p-6">
        <div className="flex items-center gap-2 text-red-700 mb-2">
          <AlertCircle className="w-5 h-5" />
          <span className="font-medium">Could not load Product Health Score</span>
        </div>
        <p className="text-sm text-red-600 mb-3">{error ?? 'Unknown error'}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-sm font-medium text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 rounded"
        >
          Try again
        </button>
      </div>
    )
  }

  const tier = TIER_CONFIG[score.tier]
  const overall = score.overall_score
  const subScoreEntries = Object.entries(score.sub_scores) as Array<[LoopName, { score: number; weight: number }]>
  // Sort by weight desc so Recruitment is at top
  subScoreEntries.sort((a, b) => b[1].weight - a[1].weight)

  return (
    <div className={`rounded-2xl border-2 p-6 ${tier.bg}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-1">
            <Activity className="w-4 h-4" />
            HOCKIA Product Health Score
          </div>
          <p className="text-xs text-gray-500">
            Strict score — only value-producing loops count. Computed {new Date(score.computed_at).toLocaleString()}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-white/60 transition-colors"
          aria-label="Refresh score"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Hero number */}
      <div className="flex items-baseline gap-3 mb-6">
        <span className={`text-6xl font-bold ${tier.color}`}>
          {Math.round(overall)}
        </span>
        <span className="text-2xl text-gray-400">/100</span>
        <span className={`ml-2 text-base font-semibold ${tier.color}`}>
          {tier.emoji} {tier.label}
        </span>
      </div>

      {/* Sub-scores */}
      <div className="space-y-2 mb-6">
        {subScoreEntries.map(([loop, sub]) => (
          <div key={loop} className="flex items-center gap-3 text-sm">
            <span className="w-32 text-gray-700 font-medium">{LOOP_LABELS[loop]}</span>
            <div className="flex-1 bg-white/60 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${barColorForScore(sub.score)}`}
                style={{ width: `${Math.min(100, Math.max(0, sub.score))}%` }}
              />
            </div>
            <span className="w-12 text-right tabular-nums font-medium text-gray-700">
              {Math.round(sub.score)}
            </span>
            <span className="w-12 text-right tabular-nums text-xs text-gray-400">
              {Math.round(sub.weight * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* Bottleneck */}
      <div className="border-t border-white/60 pt-4 mb-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          Biggest Bottleneck
        </div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-gray-900">
            {LOOP_LABELS[score.bottleneck.loop]}
          </span>
          <span className="text-sm text-gray-500">
            ({Math.round(score.bottleneck.score)}/100, {Math.round(score.bottleneck.weight * 100)}% weight)
          </span>
        </div>
        <p className="text-sm text-gray-700">{buildBottleneckExplanation(score)}</p>
      </div>

      {/* Recommended action */}
      <div className="border-t border-white/60 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          Recommended next action
        </div>
        <p className="text-sm text-gray-800">→ {buildNextActionSuggestion(score)}</p>
      </div>

      {/* Footer note */}
      <p className="mt-4 text-xs text-gray-500 italic">
        At ~{score.diagnostics.baseline.real_profiles} real users, scores below 50 are normal.
        The metric to optimize is the trend, not the absolute number.
        {!score.diagnostics.recruitment.tiers_5_6_measured && (
          <> Recruitment tiers 5–6 (club-to-applicant messaging) not yet measured.</>
        )}
      </p>
    </div>
  )
}

function barColorForScore(s: number): string {
  if (s >= 80) return 'bg-amber-500'
  if (s >= 60) return 'bg-green-500'
  if (s >= 40) return 'bg-yellow-500'
  if (s >= 20) return 'bg-orange-500'
  return 'bg-red-500'
}
