import { useMemo } from 'react'
import {
  ArrowRight,
  Award,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  FileText,
  Flag,
  Globe,
  Languages,
  Layers,
  MapPin,
  MessageSquare,
  Package,
  Shield,
  Sparkles,
  Trophy,
  Users,
  Video,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Profile } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  computeSignals,
  getOwnerSubtitle,
  type ProfileSnapshotBrandFields,
  type ProfileSnapshotMode,
  type ProfileSnapshotSignal,
} from '@/lib/profileSnapshotSignals'

/**
 * Profile Snapshot — the canonical "what visitors see" surface for every role.
 *
 * Both modes (owner + public) render PRESENT signals only as positive
 * chips. Owner mode adds a subtle "Improve your public view →" link that
 * dispatches an `edit-profile` action so the owner can add more without
 * the surface ever feeling like a checklist of gaps.
 *
 * History note: earlier versions rendered missing rows with ✓/○ icons
 * and "Add →" CTAs. That competed with NextStepCard above and turned the
 * dashboard into a wall of checklists. The chip-based positive-evidence
 * design replaces it: NextStepCard owns the "what to do next" energy,
 * Snapshot owns the "what you have" energy, and they don't overlap.
 *
 * Signal-computation logic + types live in `@/lib/profileSnapshotSignals`
 * so this file stays a clean React-component module.
 */

interface ProfileSnapshotProps {
  profile: Profile | null
  /** Brand-only: brand entity fields. Required when role is brand. */
  brand?: ProfileSnapshotBrandFields | null
  /** Brand-only: products count (passed in by BrandDashboard / BrandProfilePage to avoid a duplicate fetch here). */
  brandProductCount?: number
  /** Brand-only: ambassadors count (same rationale). */
  brandAmbassadorCount?: number
  /** Brand-only: posts count. */
  brandPostCount?: number
  /** Drives ✓-only filtering + the owner-mode "Improve your public view →" link. */
  mode: ProfileSnapshotMode
  /** Owner-mode: invoked when the owner taps the "Improve your public view"
   *  link with `actionId='edit-profile'` (or `'edit-brand'` for brand). */
  onSignalAction?: (actionId: string) => void
  /** Optional className to align with the surrounding layout. */
  className?: string
}

// ============================================================================
// Icon mapping per signal id — keeps the chips visually distinct without
// requiring profileSnapshotSignals.ts to import React/lucide.
// ============================================================================
const SIGNAL_ICONS: Record<string, LucideIcon> = {
  // Player + coach
  photo: Camera,
  position: MapPin,
  club: Building2,
  references: Shield,
  video: Video,
  journey: Briefcase,
  availability: Zap,
  activity: Sparkles,
  // Coach
  specialization: Award,
  categories: Layers,
  bio: FileText,
  // Club
  logo: Camera,
  location: MapPin,
  year_founded: Calendar,
  leagues: Trophy,
  contact: Globe,
  // Brand
  products: Package,
  ambassadors: Users,
  posts: MessageSquare,
  // Umpire
  level: Award,
  federation: Flag,
  languages: Languages,
  appointments: Calendar,
}

function iconFor(signalId: string): LucideIcon {
  return SIGNAL_ICONS[signalId] ?? Sparkles
}

export default function ProfileSnapshot({
  profile,
  brand = null,
  brandProductCount = 0,
  brandAmbassadorCount = 0,
  brandPostCount = 0,
  mode,
  onSignalAction,
  className,
}: ProfileSnapshotProps) {
  const allSignals = useMemo(
    () =>
      profile
        ? computeSignals(profile, brand, brandProductCount, brandAmbassadorCount, brandPostCount)
        : [],
    [profile, brand, brandProductCount, brandAmbassadorCount, brandPostCount],
  )

  if (!profile) return null
  if (allSignals.length === 0) return null

  const presentSignals = allSignals.filter((s) => s.present)

  // Public mode + zero present signals → render nothing (no empty state
  // for visitors). Owner mode keeps rendering so the empty-state nudge
  // ("Add a few details…") can guide a brand-new account.
  if (mode === 'public' && presentSignals.length === 0) return null

  // Brand owner uses 'edit-brand' to open the BrandDashboard edit modal;
  // every other role uses 'edit-profile'. Keep this in sync with each
  // dashboard's handleSnapshotAction switch.
  const improveActionId = profile.role === 'brand' ? 'edit-brand' : 'edit-profile'

  return (
    <section
      className={cn(
        'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm',
        className,
      )}
      aria-label="Profile Snapshot"
    >
      <header className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Profile Snapshot</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          {mode === 'owner'
            ? getOwnerSubtitle(profile.role, profile.coach_recruits_for_team ?? false)
            : 'Highlights from this profile'}
        </p>
      </header>

      {presentSignals.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Present signals">
          {presentSignals.map((signal) => (
            <SignalChip key={signal.id} signal={signal} />
          ))}
        </div>
      ) : (
        // Owner-only empty state. Public mode short-circuited above.
        <p className="text-sm text-gray-500">
          Your profile is just starting. Add a few details to make it visible.
        </p>
      )}

      {mode === 'owner' && onSignalAction && (
        <button
          type="button"
          onClick={() => onSignalAction(improveActionId)}
          className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[#8026FA] hover:text-[#6B20D4] transition-colors"
        >
          Improve your public view
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
    </section>
  )
}

// ============================================================================
// Single chip renderer
// ============================================================================

interface SignalChipProps {
  signal: ProfileSnapshotSignal
}

function SignalChip({ signal }: SignalChipProps) {
  const Icon = iconFor(signal.id)
  // Chip text: detail (e.g. "5 references") when present, else label.
  // Detail carries more information when it's a count, so prefer it.
  const text = signal.detail ?? signal.label
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700"
      title={signal.label}
    >
      <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </span>
  )
}
