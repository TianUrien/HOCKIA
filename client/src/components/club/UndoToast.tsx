import { useEffect } from 'react'
import { UNDO_WINDOW_MS, undoDecision } from '@/lib/pendingDecisions'
import { useUndoToast } from '@/lib/undoToast'

/** `aboveBar`: on the applicant review the toast sits just above the decision bar (Figma CS7). */
export function UndoToast({ aboveBar = false }: { aboveBar?: boolean } = {}) {
  const toast = useUndoToast((s) => s.toast)
  const hide = useUndoToast((s) => s.hide)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(hide, Math.max(0, UNDO_WINDOW_MS - (Date.now() - toast.at)))
    return () => clearTimeout(t)
  }, [toast, hide])
  if (!toast) return null
  return (
    <div className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 ${aboveBar ? 'bottom-[calc(env(safe-area-inset-bottom)+124px)]' : 'bottom-[calc(env(safe-area-inset-bottom)+76px)]'}`} role="status" aria-live="polite">
      <div className="pointer-events-auto flex w-full max-w-[361px] items-center justify-between gap-3 rounded-2xl bg-ink-1 py-3 pl-4 pr-2 text-white shadow-lg" data-testid="undo-toast">
        <span className="min-w-0 truncate text-row">{toast.text}</span>
        <button
          type="button"
          onClick={() => {
            // Every id is tried, so a bulk undo drops all that are still held;
            // the caller restores only those (a committed one stays decided).
            const undone = (toast.applicationIds ?? [toast.applicationId]).filter((id) => undoDecision(id))
            if (undone.length) toast.onUndo(undone)
            hide()
          }}
          className="shrink-0 rounded-full px-3 py-1.5 text-row font-semibold text-[#c4b5fd]"
        >
          Undo
        </button>
      </div>
    </div>
  )
}
