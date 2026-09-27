import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORT_THANKS,
  buildReportPayload,
  type ReportReason,
  type ReportSubject,
} from '@/lib/report'

interface ReportSheetProps {
  open: boolean
  onClose: () => void
  /** The person being reported (the author, the other chat participant, the role's publisher). */
  targetId: string
  subject: ReportSubject
  /** post / comment / conversation / opportunity id, when the report is about one. */
  contentId?: string | null
}

const TITLES: Record<ReportSubject, string> = {
  profile: 'Report this profile',
  post: 'Report this post',
  comment: 'Report this comment',
  chat: 'Report this chat',
  role: 'Report this role',
}

/**
 * The one report sheet: a reason, an optional note, send → toast
 * "Thanks. We'll review it." The reported person is never told.
 */
export function ReportSheet({ open, onClose, targetId, subject, contentId }: ReportSheetProps) {
  const addToast = useToastStore((s) => s.addToast)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) { setReason(null); setNote(''); setSending(false) }
  }, [open])

  const submit = async () => {
    if (!reason || sending) return
    setSending(true)
    try {
      const payload = buildReportPayload({ targetId, subject, reason, note, contentId })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('report_user', payload)
      if (error) throw error
      addToast(REPORT_THANKS, 'success')
      onClose()
    } catch (err) {
      logger.error('[ReportSheet] report failed', err)
      const msg = err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : ''
      addToast(/rate limit/i.test(msg) ? "You've sent a lot of reports today. Try again tomorrow." : 'Could not send the report. Please try again.', 'error')
      setSending(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={TITLES[subject]}>
      <div className="flex flex-col gap-3.5 px-5 pb-5 pt-1" data-testid="report-sheet">
        <div className="pt-1">
          <h2 className="text-[20px] font-bold leading-7 text-ink-1">{TITLES[subject]}</h2>
          <p className="mt-1 text-row text-ink-2">Pick a reason. We won&apos;t tell them you reported this.</p>
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped" role="radiogroup" aria-label="Reason">
          {REPORT_REASONS.map((r) => {
            const selected = reason === r.value
            return (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setReason(r.value)}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left text-body text-ink-1"
              >
                {r.label}
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-hockia-primary' : 'border-ink-4',
                  )}
                >
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-hockia-primary" />}
                </span>
              </button>
            )
          })}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold text-ink-2">Anything else? (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={REPORT_NOTE_MAX}
            placeholder="Add details that help us review it"
            className="w-full resize-none rounded-card bg-surface-grouped px-3.5 py-3 text-[15px] leading-[21px] text-ink-1 outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-hockia-primary/40"
          />
        </label>
        <button
          type="button"
          disabled={!reason || sending}
          onClick={() => void submit()}
          className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40"
        >
          {sending ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" onClick={onClose} className="py-1 text-body font-semibold text-hockia-primary">Cancel</button>
      </div>
    </BottomSheet>
  )
}
