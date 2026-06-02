/**
 * ProvenSignal — the "Proven" lens UI (Increment #1). A confidence tier
 * pill ("Strong evidence" / "Some evidence" / "Limited evidence") plus a
 * glanceable row of the concrete evidence facts (📹 match video · 👥 refs
 * · ✓ verified · 🏆 proven level). Renders nothing when no evidence
 * applies (recruiter gating + presence handled by useEvidence /
 * computeEvidence).
 *
 * Deliberately neutral (slate) so it reads as a separate axis from Club
 * Fit (purple) — evidence is "how sure", not "how good".
 */

import { Video, Users, BadgeCheck, Trophy, ShieldCheck } from 'lucide-react'
import type { ComponentType } from 'react'
import { evidenceLevelLabel, type EvidenceItem, type EvidenceResult } from '@/lib/evidence'

const ITEM_ICON: Record<EvidenceItem['key'], ComponentType<{ className?: string }>> = {
  video: Video,
  references: Users,
  verified: BadgeCheck,
  level: Trophy,
}

interface ProvenSignalProps {
  result: EvidenceResult
  /** 'full' = tier pill + chip row (tiles, profiles).
   *  'compact' = pill only (dense surfaces like the carousel). */
  variant?: 'full' | 'compact'
  className?: string
}

export default function ProvenSignal({ result, variant = 'full', className = '' }: ProvenSignalProps) {
  if (!result.isApplicable) return null
  const tier = evidenceLevelLabel(result.level)
  const tooltip = result.reasons.length > 0 ? `${tier} — ${result.reasons.join(' · ')}` : tier

  return (
    <div className={['flex flex-col gap-1', className].join(' ')}>
      <span
        className="inline-flex items-center gap-1 self-start rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
        title={tooltip}
        aria-label={`Evidence: ${tier}. ${result.reasons.join('. ')}`}
      >
        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
        {tier}
      </span>
      {variant === 'full' && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-gray-500">
          {result.items.map((item) => {
            const Icon = ITEM_ICON[item.key]
            return (
              <span key={item.key} className="inline-flex items-center gap-0.5" title={item.detail}>
                <Icon className="w-3 h-3 text-gray-400" />
                {item.label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
