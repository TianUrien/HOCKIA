import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { BULK_DECLINE_REASONS, DECLINE_BODY_MAX, declineGreeting, declineNoteBody, namesLine } from '@/lib/declineNotes'
import { cn } from '@/lib/utils'

/**
 * Decline several applicants at once (Figma 05 Club speed · CS5 204:1194).
 * One reason, one note for everyone. The note is a fixed template for the
 * reason (founder ruling 2026-10-17: no Hockia AI draft here); the club can
 * edit the body, and each player gets it with their own first name — the
 * greeting is shown for the first selected player as a preview.
 */
interface Props {
  open: boolean
  roleTitle: string
  /** First names in selection order (null when a profile has no name). */
  firstNames: (string | null)[]
  /** Full names for the summary line. */
  names: string[]
  onCancel: () => void
  onSend: (reason: string, body: string) => void
}

export function BulkDeclineSheet({ open, roleTitle, firstNames, names, onCancel, onSend }: Props) {
  const [reason, setReason] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState(false)
  const count = names.length
  const preview = firstNames[0] ?? null

  useEffect(() => {
    if (!open) { setReason(null); setBody(''); setEdited(false) }
  }, [open])

  const pick = (code: string) => {
    setReason(code)
    // The template follows the reason until the club writes their own words.
    if (!edited) setBody(declineNoteBody(code, roleTitle))
  }

  const canSend = Boolean(reason) && body.trim().length > 0 && body.length <= DECLINE_BODY_MAX && count > 0
  const label = count === 1 ? 'Decline 1 applicant' : `Decline ${count} applicants`

  return (
    <BottomSheet open={open} onClose={onCancel} ariaLabel={label}>
      <div className="flex flex-col gap-4 px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-1" data-testid="bulk-decline-sheet">
        <div>
          <h2 className="text-[22px] font-bold leading-[27px] tracking-[-0.13px] text-ink-1">{label}</h2>
          <p className="mt-1 text-secondary text-ink-2">{[namesLine(names), roleTitle].filter(Boolean).join(' · ')}</p>
        </div>
        <p className="text-caption font-semibold uppercase tracking-[0.48px] text-ink-2">Reason</p>
        <div className="-mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
          {BULK_DECLINE_REASONS.map((r) => (
            <button
              key={r.code}
              type="button"
              role="radio"
              aria-checked={reason === r.code}
              onClick={() => pick(r.code)}
              className={cn('flex h-9 items-center rounded-full px-3.5 text-[14px] font-semibold', reason === r.code ? 'bg-brand-soft text-brand-primary' : 'border border-line text-ink-1')}
            >
              {r.label}
            </button>
          ))}
        </div>
        {reason && (
          <>
            <p className="text-caption font-semibold uppercase tracking-[0.48px] text-ink-2">Note · sent to each player</p>
            <div className="-mt-1.5 flex flex-col gap-2.5 rounded-[16px] bg-surface-subtle px-4 py-3.5 focus-within:ring-2 focus-within:ring-focus-ring" data-testid="bulk-decline-note">
              <div className="text-body text-ink-1">
                <p data-testid="bulk-decline-greeting">{declineGreeting(preview)}</p>
                <textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setEdited(true) }}
                  rows={Math.max(4, Math.ceil(body.length / 38))}
                  maxLength={DECLINE_BODY_MAX}
                  aria-label="Note to each player"
                  className="block w-full resize-none bg-transparent text-body text-ink-1 outline-none focus-visible:outline-none"
                />
              </div>
              {count > 1 && preview && (
                <span className="self-start rounded-full bg-surface-muted px-2 py-[3px] text-caption text-ink-2">Preview for {preview}</span>
              )}
            </div>
          </>
        )}
        <p className="text-secondary text-ink-2">Each player gets their own email with their own first name. The note also appears on their application, which shows “Not selected”.</p>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => reason && onSend(reason, body.trim())}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40"
          data-testid="bulk-decline-send"
        >
          {count === 1 ? 'Decline and send' : `Decline ${count} and send`}
        </button>
        <button type="button" onClick={onCancel} className="-mt-2 flex min-h-11 w-full items-center justify-center text-body font-semibold text-hockia-primary">Cancel</button>
      </div>
    </BottomSheet>
  )
}
