import { useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { logger } from '@/lib/logger'

/**
 * Danger confirmation as a bottom sheet (Figma Button / Danger, Large 48;
 * decisions.md: Destructive (soft) opens a negative action, Danger (solid)
 * confirms it). Every Danger confirmation on the phone club and player
 * screens uses this shape — DeclineSheet, the withdraw-application sheet,
 * Withdraw offer, Undo signing and Not interested — so there is one
 * confirmation surface, never a centred modal (ConfirmDialog stays for the
 * desktop v1 screens only).
 *
 * `tone` is "danger" by default. "primary" is for a player saying no
 * (Decline offer, Not interested): founder ruling 2026-10-02/03, a player's
 * no is a normal choice and is never shown as destructive.
 *
 * `onConfirm` may throw or reject: the sheet then stays open (the caller
 * has already toasted the reason) and nothing else happens.
 */
interface ConfirmSheetProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  message: string
  /** Label of the solid confirm button. */
  confirmLabel: string
  tone?: 'danger' | 'primary'
  cancelLabel?: string
  /** Label while the action runs; defaults to "Working…". */
  busyLabel?: string
  testId?: string
}

export function ConfirmSheet({ open, onClose, onConfirm, title, message, confirmLabel, tone = 'danger', cancelLabel = 'Cancel', busyLabel = 'Working…', testId }: ConfirmSheetProps) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (error) {
      logger.error('ConfirmSheet action failed:', error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={() => { if (!busy) onClose() }} ariaLabel={title}>
      <div className="px-5 pb-2 pt-2 text-center" data-testid={testId}>
        <h2 className="text-title text-ink-1">{title}</h2>
        <p className="mt-2 text-row leading-[21px] text-ink-2">{message}</p>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className={`mt-5 flex h-12 w-full items-center justify-center rounded-full text-[16px] font-semibold text-white disabled:opacity-60 ${tone === 'primary' ? 'bg-hockia-primary active:opacity-90' : 'bg-status-danger active:bg-status-danger-strong'}`}
          data-testid={testId ? `${testId}-yes` : undefined}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-ink-1 disabled:opacity-60">
          {cancelLabel}
        </button>
      </div>
    </BottomSheet>
  )
}
