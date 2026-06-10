/**
 * ContextEditSheet — modal sheet for picking, creating, and
 * deleting recruiting contexts.
 *
 * Sprint 2. Opened by the ContextSwitcher chip. Two zones:
 *   1. Saved contexts list — radio-style; tap to activate. The
 *      active row is highlighted; a small trash icon per row
 *      offers delete. The auto-seeded 'club' context cannot be
 *      deleted (it's the implicit profile-derived fallback).
 *   2. Create form — Target (Men/Women/Mixed), optional Region,
 *      optional Label. Save calls create() which auto-activates.
 *
 * The sheet stays consistent with the OpportunityFilterSheet
 * shell (Modal + sticky header with Close / Done + scrollable
 * body) so the patterns read as one app.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Check, AlertCircle, Briefcase, Loader2 } from 'lucide-react'
import Modal from '../Modal'
import {
  useRecruitingContext,
  opportunityGenderToTarget,
  type RecruitingContextRow,
  type RecruitingTargetCategory,
} from '@/hooks/useRecruitingContext'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { reportSupabaseError } from '@/lib/sentryHelpers'

/** Shape the picker uses. Carries pre-derived `target` so the
 *  active-closed-opp synthesizer (see visibleOpps below) can fill
 *  it from the context row without us re-running the gender→target
 *  mapping. */
interface OwnedOpportunity {
  id: string
  title: string
  target: RecruitingTargetCategory | null
  location_city: string | null
  status: string
}

interface ContextEditSheetProps {
  isOpen: boolean
  onClose: () => void
}

const TARGET_OPTIONS: { value: RecruitingTargetCategory; label: string; helper: string }[] = [
  { value: 'Women', label: "Women's team", helper: 'Adult women, girls, and mixed-category players.' },
  { value: 'Men', label: "Men's team", helper: 'Adult men, boys, and mixed-category players.' },
  { value: 'Mixed', label: 'Mixed / Both', helper: 'All player categories — broadest fit window.' },
]

export default function ContextEditSheet({ isOpen, onClose }: ContextEditSheetProps) {
  const { active, available, error, activate, clearActive, create, activateForOpportunity, remove, clearError } = useRecruitingContext()
  const { user } = useAuthStore()
  const { addToast } = useToastStore()

  const [creating, setCreating] = useState(false)
  const [draftTarget, setDraftTarget] = useState<RecruitingTargetCategory | null>(null)
  const [draftRegion, setDraftRegion] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [busy, setBusy] = useState(false)

  // Fetch the viewer's own opportunities so they can scope to one
  // directly from the picker — without having to navigate to that
  // opportunity's Applicants page. Loaded lazily when the sheet
  // opens; results persist across close/reopen so the second open
  // is instant. Four-state model so the UI never shows a confusing
  // empty section while the fetch is in flight:
  //   - 'idle'    : haven't fetched yet (first paint before effect)
  //   - 'loading' : fetch in flight
  //   - 'error'   : fetch failed
  //   - 'loaded'  : fetched (ownedOpps may be empty)
  type OppsStatus = 'idle' | 'loading' | 'error' | 'loaded'
  const [ownedOpps, setOwnedOpps] = useState<OwnedOpportunity[]>([])
  const [oppsStatus, setOppsStatus] = useState<OppsStatus>('idle')

  const fetchOwnedOpps = useCallback(async (signal: { cancelled: boolean }) => {
    if (!user) return
    setOppsStatus('loading')
    // Open opportunities only — closed/draft postings would clutter
    // the picker with finished work. The active-context case (if a
    // recruiter scoped to an opp that later closed) is handled by
    // visibleOpps below, which synthesizes a row from the context.
    const { data, error: fetchError } = await supabase
      .from('opportunities')
      .select('id, title, gender, location_city, status')
      .eq('club_id', user.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50)
    if (signal.cancelled) return
    if (fetchError) {
      reportSupabaseError('ContextEditSheet.fetchOpps', fetchError)
      setOppsStatus('error')
      return
    }
    setOwnedOpps(
      (data ?? []).map((opp) => ({
        id: opp.id as string,
        title: opp.title as string,
        target: opportunityGenderToTarget(opp.gender as string | null),
        location_city: opp.location_city as string | null,
        status: opp.status as string,
      })),
    )
    setOppsStatus('loaded')
  }, [user])

  useEffect(() => {
    if (!isOpen || !user) return
    const signal = { cancelled: false }
    void fetchOwnedOpps(signal)
    return () => { signal.cancelled = true }
  }, [isOpen, user, fetchOwnedOpps])

  /** Visible picker rows = the fetched open opps, optionally PLUS the
   *  active context's opp if it's not in the list (the opp closed,
   *  was archived, or fell past the 50-row LIMIT after a context was
   *  set). Without this synthesis, an opp-scoped active context with
   *  no matching open row would render the picker with NOTHING
   *  highlighted — recreating the exact "feels forced, can't see
   *  what's active" bug we just fixed. */
  const visibleOpps = useMemo<OwnedOpportunity[]>(() => {
    if (!active?.opportunity_id) return ownedOpps
    if (ownedOpps.some((o) => o.id === active.opportunity_id)) return ownedOpps
    const synthesized: OwnedOpportunity = {
      id: active.opportunity_id,
      title: active.label ?? '(Active opportunity)',
      target: (active.target_category ?? null) as RecruitingTargetCategory | null,
      location_city: active.region,
      status: 'closed',
    }
    return [synthesized, ...ownedOpps]
  }, [ownedOpps, active])

  const resetForm = () => {
    setCreating(false)
    setDraftTarget(null)
    setDraftRegion('')
    setDraftLabel('')
  }

  const handleClose = () => {
    resetForm()
    clearError()
    onClose()
  }

  const handleActivate = async (row: RecruitingContextRow) => {
    if (row.id === active?.id) return
    setBusy(true)
    await activate(row.id)
    setBusy(false)
  }

  const handleClearActive = async () => {
    if (!active) return
    setBusy(true)
    await clearActive()
    setBusy(false)
  }

  const handlePickOpportunity = async (opp: OwnedOpportunity) => {
    // No-op if the active context already points at this opportunity.
    if (active?.opportunity_id === opp.id) return
    setBusy(true)
    const row = await activateForOpportunity({
      opportunityId: opp.id,
      target: opp.target,
      region: opp.location_city ?? null,
      label: opp.title,
    })
    setBusy(false)
    // F3 fix: the auto-scope path on ApplicantsList /
    // OpportunityDetailPage toasts; the manual-picker path was silent
    // (QA F3). Surface the same toast so both flows feel consistent.
    if (row) {
      addToast(
        opp.target
          ? `Recruiting scoped to this opportunity (${opp.target}).`
          : 'Recruiting scoped to this opportunity.',
        'success',
      )
    }
  }

  const handleSave = async () => {
    if (!draftTarget) return
    setBusy(true)
    await create({
      type: 'custom',
      target_category: draftTarget,
      region: draftRegion.trim() || null,
      label: draftLabel.trim() || null,
    })
    setBusy(false)
    resetForm()
  }

  const handleDelete = async (row: RecruitingContextRow) => {
    if (row.type === 'club') return
    setBusy(true)
    await remove(row.id)
    setBusy(false)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className="!max-w-md !max-h-[85vh]"
      showClose={false}
    >
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Recruiting context</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Optional — personalises Fit chips + featured players to a target. Only you see this.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Done
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{error}</p>
                <p className="text-red-700/80 mt-0.5">Try again — your previous context is preserved.</p>
              </div>
              <button
                type="button"
                onClick={clearError}
                className="text-red-600 hover:text-red-800 font-medium text-xs flex-shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* "No active context" toggle — always visible so users can
              opt out of any active scope without losing their saved
              rows. This is the radio that makes the picker non-modal:
              before Sprint 4, tapping the active row was a no-op and
              users felt forced to keep a context. */}
          <ul className="space-y-2">
            <li
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors',
                !active
                  ? 'border-[#8026FA] bg-[#8026FA]/5'
                  : 'border-gray-200 hover:border-gray-300',
              ].join(' ')}
            >
              <button
                type="button"
                role="radio"
                onClick={handleClearActive}
                disabled={busy || !active}
                aria-label="No context: Fit chips and featured players use your profile"
                aria-checked={!active ? 'true' : 'false'}
                className="flex-1 flex items-center gap-3 text-left disabled:opacity-100"
              >
                <span
                  className={[
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                    !active
                      ? 'border-[#8026FA] bg-[#8026FA]'
                      : 'border-gray-300',
                  ].join(' ')}
                >
                  {!active && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">No context</p>
                  <p className="text-xs text-gray-500">Fit chips + featured players use your profile.</p>
                </div>
              </button>
            </li>
          </ul>

          {/* "Your opportunities" picker — lets a recruiter scope to
              one of their own postings without navigating to that
              opportunity's Applicants page first. Hidden when the
              user has no opportunities, and when loading just shows
              a tiny placeholder so the section doesn't pop in late. */}
          {/* "Your opportunities" — always-mounted so the sheet's
              layout is stable across the fetch lifecycle. Renders
              loading / error / empty / loaded explicitly so the user
              never sees content "pop in" without context. */}
          <div>
            <p className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Your opportunities
            </p>
            {(oppsStatus === 'idle' || oppsStatus === 'loading') && visibleOpps.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                Loading your opportunities…
              </div>
            ) : oppsStatus === 'error' && visibleOpps.length === 0 ? (
              <button
                type="button"
                onClick={() => {
                  const signal = { cancelled: false }
                  void fetchOwnedOpps(signal)
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 hover:bg-red-100 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Couldn&rsquo;t load opportunities.
                </span>
                <span className="font-medium underline">Try again</span>
              </button>
            ) : visibleOpps.length === 0 ? (
              <div className="px-3 py-2.5 rounded-lg border border-dashed border-gray-200 text-xs text-gray-500 italic">
                You haven&rsquo;t posted any opportunities yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {visibleOpps.map((opp) => {
                  const isActive = active?.opportunity_id === opp.id
                  const isClosed = opp.status !== 'open'
                  return (
                    <li
                      key={opp.id}
                      className={[
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors',
                        isActive
                          ? 'border-[#8026FA] bg-[#8026FA]/5'
                          : 'border-gray-200 hover:border-gray-300',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        role="radio"
                        onClick={() => handlePickOpportunity(opp)}
                        disabled={busy}
                        aria-label={`Recruiting context: ${opp.title}${opp.location_city ? ` — ${opp.location_city}` : ''}${opp.target ? ` — ${opp.target}` : ''}`}
                        aria-checked={isActive || undefined}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left disabled:opacity-50"
                      >
                        <span
                          className={[
                            'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                            isActive
                              ? 'border-[#8026FA] bg-[#8026FA]'
                              : 'border-gray-300',
                          ].join(' ')}
                        >
                          {isActive && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                        </span>
                        <Briefcase className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {opp.title}
                            {isClosed && (
                              <span className="ml-2 text-[10px] font-normal text-gray-400 uppercase tracking-wider">
                                closed
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {opp.target ?? 'Unscoped'}
                            {opp.location_city ? ` · ${opp.location_city}` : ''}
                          </p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Custom contexts the user explicitly created via the
              "+ New context" form below. Excludes type='opportunity'
              rows — those surface under "Your opportunities" instead
              so the picker stays organized by source. */}
          <ul className="space-y-2">
            {available.filter((row) => row.type !== 'opportunity').map((row) => {
              const isActive = row.id === active?.id
              return (
                <li
                  key={row.id}
                  className={[
                    'group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors',
                    isActive
                      ? 'border-[#8026FA] bg-[#8026FA]/5'
                      : 'border-gray-200 hover:border-gray-300',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    role="radio"
                    onClick={() => handleActivate(row)}
                    disabled={busy}
                    aria-label={`Recruiting context: ${row.label || row.target_category}${row.region ? ` — ${row.region}` : ''}`}
                    aria-checked={isActive || undefined}
                    className="flex-1 flex items-center gap-3 text-left disabled:opacity-50"
                  >
                    <span
                      className={[
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                        isActive
                          ? 'border-[#8026FA] bg-[#8026FA]'
                          : 'border-gray-300',
                      ].join(' ')}
                    >
                      {isActive && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {row.label || formatRowFallback(row)}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {row.target_category ?? 'No target set'}
                        {row.region ? ` · ${row.region}` : ''}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(row)}
                    disabled={busy}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    aria-label={`Delete context: ${row.label || row.target_category}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
                )
              })}
          </ul>

          {/* Create form */}
          {creating ? (
            <div className="space-y-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Target team
                </label>
                <div className="space-y-1.5">
                  {TARGET_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-white"
                    >
                      <input
                        type="radio"
                        name="target"
                        checked={draftTarget === opt.value}
                        onChange={() => setDraftTarget(opt.value)}
                        className="mt-0.5 w-4 h-4 accent-[#8026FA]"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-gray-900">{opt.label}</span>
                        <span className="block text-xs text-gray-500">{opt.helper}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Region <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={draftRegion}
                  onChange={(e) => setDraftRegion(e.target.value)}
                  placeholder="e.g., Buenos Aires, Europe, Latin America"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Label <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  placeholder="e.g., Women's team — next season"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={busy}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!draftTarget || busy}
                  className="px-3 py-1.5 text-sm font-semibold bg-[#8026FA] text-white rounded-lg hover:bg-[#6b1de0] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {busy ? 'Saving…' : 'Save & activate'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-[#8026FA] hover:text-[#8026FA] transition-colors"
            >
              <Plus className="w-4 h-4" />
              New context
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function formatRowFallback(row: RecruitingContextRow): string {
  const parts: string[] = []
  if (row.target_category) parts.push(row.target_category)
  if (row.region) parts.push(row.region)
  return parts.length > 0 ? parts.join(' · ') : 'Untitled context'
}
