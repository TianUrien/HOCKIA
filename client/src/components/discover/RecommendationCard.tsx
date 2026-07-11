import { useNavigate } from 'react-router-dom'
import { Check, ArrowRight, Info } from 'lucide-react'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import type { RecommendationRow } from '@/hooks/useDiscover'

// Match-strength pill — same vocabulary as the discover result cards so a
// "Strong match" reads the same way wherever Hockia AI shows one.
const FIT_LEVEL_PRESET: Record<RecommendationRow['fit_level'], {
  label: string; pillBg: string; pillText: string
}> = {
  strong_match: { label: 'Strong match', pillBg: 'bg-emerald-50', pillText: 'text-emerald-700' },
  possible_match: { label: 'Good match', pillBg: 'bg-sky-50', pillText: 'text-sky-700' },
  needs_more_info: { label: 'Needs more info', pillBg: 'bg-gray-100', pillText: 'text-gray-600' },
}

// Triage badge — shown only when the owner has *already* labelled this
// applicant on the Applicants screen. `pending` = Unsorted = no badge
// (that's the AI's primary surface; nothing to acknowledge).
const TRIAGE_PRESET: Record<string, { bg: string; text: string }> = {
  shortlisted: { bg: 'bg-emerald-50', text: 'text-emerald-700' }, // Good fit
  maybe: { bg: 'bg-amber-50', text: 'text-amber-700' },
}

interface RecommendationCardProps {
  rec: RecommendationRow
}

/**
 * One recruitment recommendation. Photo, name + role + (triage badge if the
 * owner has already labelled), fit pill, an opening-context line, up to 4
 * green-checkmark bullets anchored to profile data, and a "Review applicant"
 * CTA that opens the public profile in one tap.
 */
export default function RecommendationCard({ rec }: RecommendationCardProps) {
  const navigate = useNavigate()
  const fitPreset = FIT_LEVEL_PRESET[rec.fit_level]
  const triagePreset = rec.triage !== 'pending' ? TRIAGE_PRESET[rec.triage] : null

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* Header — photo · name + role + triage badge · fit pill */}
      <div className="flex items-start gap-3">
        <Avatar
          src={rec.applicant_avatar_url}
          alt={rec.applicant_name ?? undefined}
          initials={rec.applicant_name?.charAt(0)}
          size="md"
          role={rec.applicant_role}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">
              {rec.applicant_name ?? 'Unknown'}
            </span>
            <RoleBadge role={rec.applicant_role} className="flex-shrink-0" />
            {triagePreset && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${triagePreset.bg} ${triagePreset.text}`}
              >
                {rec.triage_label}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 truncate">
            For your <span className="font-medium text-gray-700">{rec.opening_title}</span> opening
          </p>
        </div>
        <span
          className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${fitPreset.pillBg} ${fitPreset.pillText}`}
        >
          {fitPreset.label}
        </span>
      </div>

      {/* Bullets — every line is anchored to data on this profile. */}
      {rec.bullets.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {rec.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700 leading-snug">
              <Check className="w-3.5 h-3.5 text-emerald-600 mt-px flex-shrink-0" aria-hidden="true" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Caveats — neutral acknowledgement of a notable missing signal, so
          the owner sees what the AI weighed and what it didn't. */}
      {rec.caveats && rec.caveats.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {rec.caveats.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-gray-500 leading-snug">
              <Info className="w-3.5 h-3.5 text-gray-400 mt-px flex-shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Review applicant — one tap to the public profile. */}
      <button
        type="button"
        onClick={() => navigate(rec.navigate_to)}
        className="mt-3 w-full flex items-center justify-center gap-1 min-h-[40px] py-2 rounded-lg bg-gradient-to-br from-hockia-primary to-hockia-secondary text-white text-xs font-medium hover:opacity-90 transition-opacity"
      >
        Review applicant
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
