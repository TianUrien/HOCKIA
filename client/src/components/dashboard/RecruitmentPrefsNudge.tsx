/**
 * RecruitmentPrefsNudge — a dismissible card prompting players/coaches to
 * add their recruitment preferences (the 🤝 Interested-lens intent fields:
 * relocation, availability, level target, etc.). Matching Increment #2.
 *
 * Shows only when: the viewer is a player/coach, hasn't set ANY preference
 * yet, and hasn't dismissed the card (persisted in localStorage per user).
 * "Add now" opens the edit-profile modal; "Maybe later" dismisses.
 *
 * We intentionally keep this OUT of onboarding (no new required steps) —
 * this gentle nudge is the agreed low-friction path to collect intent.
 */

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { Profile } from '@/lib/supabase'

interface RecruitmentPrefsNudgeProps {
  profile: Profile | null | undefined
  onAdd: () => void
}

const dismissKey = (id: string) => `hockia:dismiss-recruitment-nudge:${id}`

/** True when the candidate has set at least one recruitment preference. */
function hasAnyPreference(p: Profile): boolean {
  return Boolean(
    p.relocation_willingness ||
      p.available_from ||
      p.availability_duration ||
      p.level_target ||
      p.opportunity_preference ||
      (p.relocation_countries_open?.length ?? 0) > 0 ||
      (p.relocation_countries_excluded?.length ?? 0) > 0,
  )
}

export default function RecruitmentPrefsNudge({ profile, onAdd }: RecruitmentPrefsNudgeProps) {
  const isCandidate = profile?.role === 'player' || profile?.role === 'coach'
  const [dismissed, setDismissed] = useState(() => {
    if (!profile?.id) return false
    try {
      return localStorage.getItem(dismissKey(profile.id)) === '1'
    } catch {
      return false
    }
  })

  if (!profile || !isCandidate || dismissed || hasAnyPreference(profile)) return null

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(profile.id), '1')
    } catch {
      /* private mode — fall back to in-session dismissal */
    }
    setDismissed(true)
  }

  return (
    <div className="relative rounded-2xl border border-[#8026FA]/20 bg-gradient-to-br from-[#8026FA]/5 to-[#924CEC]/5 p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-2.5 right-2.5 rounded-full p-1 text-gray-400 hover:bg-black/5 hover:text-gray-600"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <span className="flex-shrink-0 mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#8026FA]/10 text-[#8026FA]">
          <Sparkles className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Get better matches</p>
          <p className="text-xs text-gray-600 mt-0.5">
            Tell recruiters what you're looking for — relocation, availability, level. Takes a minute, sharpens every match.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onAdd}
              className="rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Add now
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
