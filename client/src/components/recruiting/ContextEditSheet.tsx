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

import { useState } from 'react'
import { Plus, Trash2, Check, AlertCircle } from 'lucide-react'
import Modal from '../Modal'
import {
  useRecruitingContext,
  type RecruitingContextRow,
  type RecruitingTargetCategory,
} from '@/hooks/useRecruitingContext'

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
  const { active, available, error, activate, create, remove, clearError } = useRecruitingContext()

  const [creating, setCreating] = useState(false)
  const [draftTarget, setDraftTarget] = useState<RecruitingTargetCategory | null>(null)
  const [draftRegion, setDraftRegion] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [busy, setBusy] = useState(false)

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
              Scopes Club Fit + carousel filters. Only you see this.
            </p>
          </div>
          <button
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

          {available.length === 0 && !creating && (
            <p className="text-sm text-gray-500 italic">
              No contexts yet — create one below to start scouting.
            </p>
          )}

          {/* Saved contexts list */}
          {available.length > 0 && (
            <ul className="space-y-2">
              {available.map((row) => {
                const isActive = row.id === active?.id
                const canDelete = row.type !== 'club'
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
                      onClick={() => handleActivate(row)}
                      disabled={busy}
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
                          {row.type === 'club' && ' · auto-seeded from profile'}
                        </p>
                      </div>
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={busy}
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        aria-label={`Delete context: ${row.label || row.target_category}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

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
