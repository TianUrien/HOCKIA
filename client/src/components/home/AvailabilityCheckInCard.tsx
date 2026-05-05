import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Edit2, Sparkles, X, Zap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ownProfileEditPath } from '@/lib/profileNavigation'
import type { PulseItem } from '@/hooks/useMyPulse'

/**
 * AvailabilityCheckInCard — Loop Layer L2 (v5 plan).
 *
 * Fires every Monday via pg_cron's enqueue_availability_check_ins().
 * The user gets one of three role-shaped questions:
 *   - Player: "Are you still open to play?"
 *   - Coach (recruiter mode): "Still recruiting players?"
 *   - Coach (candidate mode): "Still open to coaching opportunities?"
 *   - Umpire: "Still active as an umpire?"
 *
 * One tap on "Yes, still open" calls confirm_availability() which stamps
 * profiles.availability_confirmed_at and last_meaningful_update_at. The
 * Snapshot's "Open to play / coach" chip refreshes on next render with
 * the 60-day clock reset.
 *
 * "Not right now" opens the user's edit profile flow with the
 * availability section focused so they can flip the toggle off cleanly.
 *
 * This is the first Pulse card to use mark_pulse_action_completed —
 * the funnel data captured (created → seen → clicked → action_completed)
 * is exactly what AI ranking will use later to identify active vs stale
 * users.
 */

interface AvailabilityCheckInCardProps {
  item: PulseItem
  onClick: (id: string) => void
  onDismiss: (id: string) => void
}

type Role = 'player' | 'coach' | 'umpire'

function readBoolean(metadata: PulseItem['metadata'], path: readonly [string, string]): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const outer = (metadata as Record<string, unknown>)[path[0]]
  if (!outer || typeof outer !== 'object' || Array.isArray(outer)) return false
  const value = (outer as Record<string, unknown>)[path[1]]
  return value === true
}

function readString(metadata: PulseItem['metadata'], path: readonly [string, string]): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const outer = (metadata as Record<string, unknown>)[path[0]]
  if (!outer || typeof outer !== 'object' || Array.isArray(outer)) return null
  const value = (outer as Record<string, unknown>)[path[1]]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

interface CheckInCopy {
  question: string
  rationale: string
}

function buildCopy(role: Role, recruitsForTeam: boolean): CheckInCopy {
  switch (role) {
    case 'player':
      return {
        question: 'Are you still open to play?',
        rationale: 'Confirming weekly keeps your profile fresh — clubs trust active players.',
      }
    case 'coach':
      return recruitsForTeam
        ? {
            question: 'Still recruiting players?',
            rationale: 'A weekly check keeps your candidate searches relevant.',
          }
        : {
            question: 'Still open to coaching opportunities?',
            rationale: 'Confirming weekly keeps your profile fresh — clubs trust active coaches.',
          }
    case 'umpire':
      return {
        question: 'Still active as an umpire?',
        rationale: 'A weekly confirmation keeps your appointments and references current.',
      }
  }
}

// profileEditPath helper removed in favour of the shared
// `ownProfileEditPath` from `@/lib/profileNavigation`, which falls back
// to `/players/id/<uuid>` when username is null (every account today).

export function AvailabilityCheckInCard({
  item,
  onClick,
  onDismiss,
}: AvailabilityCheckInCardProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((state) => state.profile)
  const setProfile = useAuthStore((state) => state.setProfile)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const metadataRole = readString(item.metadata, ['current_state', 'role']) as Role | null
  const role = (metadataRole ?? profile?.role) as Role | null
  if (!role || !['player', 'coach', 'umpire'].includes(role)) return null

  const recruitsForTeam = readBoolean(item.metadata, ['current_state', 'coach_recruits_for_team'])
  const copy = buildCopy(role, recruitsForTeam)

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('confirm_availability')
      if (error) throw error

      // Optimistically update the local profile so the Snapshot chip
      // refreshes immediately. Server has the authoritative value; this
      // just avoids a full refetch.
      if (profile) {
        const now = new Date().toISOString()
        setProfile({
          ...profile,
          availability_confirmed_at: now,
          last_meaningful_update_at: now,
        })
      }

      // Stamp action_completed_at via the canonical RPC. This is the
      // first Pulse card to do it — the funnel telemetry starts here.
      const { error: actionError } = await supabase.rpc('mark_pulse_action_completed', {
        p_pulse_id: item.id,
      })
      if (actionError) throw actionError

      setConfirmed(true)
      // Auto-dismiss after the celebratory state has had a beat to land.
      window.setTimeout(() => onDismiss(item.id), 1400)
    } catch (err) {
      logger.error('[AvailabilityCheckInCard] confirm_availability failed', err)
      setBusy(false)
    }
  }

  const handleNotNow = () => {
    onClick(item.id)
    const path = ownProfileEditPath(role, profile?.username, profile?.id)
    if (path) navigate(path)
  }

  const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDismiss(item.id)
  }

  if (confirmed) {
    return (
      <article
        className="relative rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm"
        data-testid="pulse-availability-check-in-confirmed"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Confirmed — thanks for checking in.</p>
            <p className="text-xs text-gray-600 mt-0.5">Your profile stays fresh for another 60 days.</p>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article
      className="relative rounded-2xl border border-[#8026FA]/20 bg-gradient-to-br from-[#8026FA]/[0.06] via-white to-[#ec4899]/[0.04] p-4 shadow-sm"
      data-testid="pulse-availability-check-in"
    >
      <button
        type="button"
        onClick={handleDismiss}
        disabled={busy}
        className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8026FA] to-[#ec4899] text-white shadow-sm">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8026FA] mb-0.5">
            Weekly check-in
          </p>
          <h3 className="text-base font-semibold text-gray-900 leading-snug">{copy.question}</h3>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">{copy.rationale}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-4 py-1.5 text-xs font-semibold shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              <Zap className="w-3 h-3" aria-hidden="true" />
              Yes, still open
            </button>
            <button
              type="button"
              onClick={handleNotNow}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white text-gray-700 px-4 py-1.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <Edit2 className="w-3 h-3" aria-hidden="true" />
              Not right now
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
