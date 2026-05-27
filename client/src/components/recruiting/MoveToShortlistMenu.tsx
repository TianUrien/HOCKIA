/**
 * MoveToShortlistMenu — small popover-style picker that lists the
 * viewer's shortlists and moves an item into the chosen one.
 *
 * Used in two places:
 *   - ShortlistDetailPage row "Move to" affordance (mode='move' —
 *     the current list is greyed out as "current")
 *   - QuickActionsRow on Community cards (mode='add' — uses the
 *     shortlist's add() so a player can be sent to any list, not
 *     just the default)
 *
 * Closes on outside click + Escape. Has an inline "+ New list" CTA
 * so the user can create a destination list without leaving the
 * picker.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Check, Loader2 } from 'lucide-react'
import { useShortlists } from '@/hooks/useShortlists'

interface MoveToShortlistMenuProps {
  /** Anchor — picker renders inside the parent so position it with
   *  `relative` on the wrapping element. */
  open: boolean
  onClose: () => void
  /** Called when the user picks a destination list. Parent is
   *  responsible for the actual move / add side effect. */
  onPick: (shortlistId: string) => Promise<void> | void
  /** Optional: ID of the list the item is CURRENTLY in (used in
   *  'move' mode to grey it out). Omit in 'add' mode. */
  currentShortlistId?: string | null
  /** Optional title at the top of the picker. */
  title?: string
}

export default function MoveToShortlistMenu({
  open,
  onClose,
  onPick,
  currentShortlistId,
  title = 'Move to…',
}: MoveToShortlistMenuProps) {
  const { lists, loading, create } = useShortlists()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Outside-click + Escape to close.
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  const handlePick = useCallback(async (id: string) => {
    setBusy(true)
    await onPick(id)
    setBusy(false)
    onClose()
  }, [onPick, onClose])

  const handleCreateAndPick = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    setBusy(true)
    const created = await create(trimmed)
    if (created) {
      await onPick(created.id)
      setDraft('')
      setCreating(false)
      onClose()
    }
    setBusy(false)
  }, [draft, create, onPick, onClose])

  if (!open) return null

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={title}
      className="absolute right-0 top-full mt-1 z-30 w-64 rounded-xl border border-gray-200 bg-white shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-gray-100">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {loading && lists.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading lists…
          </div>
        ) : lists.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-500 italic">
            No lists yet. Create one below.
          </p>
        ) : (
          lists.map((list) => {
            const isCurrent = list.id === currentShortlistId
            return (
              <button
                key={list.id}
                type="button"
                disabled={isCurrent || busy}
                onClick={() => void handlePick(list.id)}
                className={[
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                  isCurrent
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-gray-900 hover:bg-[#8026FA]/5',
                ].join(' ')}
              >
                <span className="truncate flex-1">
                  {list.name}
                  {list.is_default && (
                    <span className="ml-1.5 text-[9px] uppercase tracking-wider text-[#8026FA] font-bold">
                      default
                    </span>
                  )}
                </span>
                {isCurrent ? (
                  <span className="text-[10px] uppercase tracking-wider text-gray-400">current</span>
                ) : (
                  <span className="text-[10px] text-gray-400">{list.item_count}</span>
                )}
              </button>
            )
          })
        )}
      </div>

      <div className="border-t border-gray-100 p-2">
        {creating ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateAndPick()
                if (e.key === 'Escape') { setCreating(false); setDraft('') }
              }}
              placeholder="New list name"
              className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-xs focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCreateAndPick}
              disabled={busy || !draft.trim()}
              className="p-1.5 rounded text-[#8026FA] hover:bg-[#8026FA]/10 disabled:opacity-40"
              aria-label="Create and add"
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-[#8026FA] hover:bg-[#8026FA]/5 rounded"
          >
            <Plus className="w-3.5 h-3.5" />
            New list
          </button>
        )}
      </div>
    </div>
  )
}
