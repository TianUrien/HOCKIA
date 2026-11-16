import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  buildReportPayload,
  reportReasonLabel,
  reportThanks,
  type ReportReason,
  type ReportSubject,
} from '@/lib/report'
import { useInboxT } from '@/i18n/ns/inbox'

interface ReportSheetProps {
  open: boolean
  onClose: () => void
  /** The person being reported (the author, the other chat participant, the role's publisher). */
  targetId: string
  subject: ReportSubject
  /** post / comment / conversation / opportunity id, when the report is about one. */
  contentId?: string | null
  /**
   * After the report is sent, offer to block the person too (founder
   * 2026-11-10: someone reporting a chat usually also wants it to stop).
   * The caller blocks; the sheet only asks.
   */
  offerBlock?: { name: string; onBlock: () => void }
}

const TITLE_KEYS = {
  profile: 'safety.report.titles.profile',
  post: 'safety.report.titles.post',
  comment: 'safety.report.titles.comment',
  chat: 'safety.report.titles.chat',
  role: 'safety.report.titles.role',
  feed_item: 'safety.report.titles.feedItem',
  feed_item_comment: 'safety.report.titles.feedItemComment',
  video: 'safety.report.titles.video',
  offer: 'safety.report.titles.offer',
} as const satisfies Record<ReportSubject, string>

/**
 * The one report sheet: a reason, an optional note, send → toast
 * "Thanks. We'll review it." The reported person is never told.
 */
export function ReportSheet({ open, onClose, targetId, subject, contentId, offerBlock }: ReportSheetProps) {
  const t = useInboxT()
  const addToast = useToastStore((s) => s.addToast)
  const title = t(TITLE_KEYS[subject])
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) { setReason(null); setNote(''); setSending(false); setSent(false) }
  }, [open])

  const submit = async () => {
    if (!reason || sending) return
    setSending(true)
    try {
      const payload = buildReportPayload({ targetId, subject, reason, note, contentId })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('report_user', payload)
      if (error) throw error
      addToast(reportThanks(), 'success')
      if (offerBlock) setSent(true)
      else onClose()
    } catch (err) {
      logger.error('[ReportSheet] report failed', err)
      const msg = err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : ''
      addToast(/rate limit/i.test(msg) ? t('safety.report.rateLimited') : t('safety.report.failed'), 'error')
      setSending(false)
    }
  }

  if (sent && offerBlock) {
    return (
      <BottomSheet open={open} onClose={onClose} ariaLabel={t('safety.report.blockOffer.label', { name: offerBlock.name })}>
        <div className="px-5 pb-2 pt-2 text-center" data-testid="report-block-offer">
          <h2 className="text-title text-ink-1">{t('safety.report.blockOffer.title')}</h2>
          <p className="mt-2 text-row leading-[21px] text-ink-2">
            {t('safety.report.blockOffer.body', { name: offerBlock.name })}
          </p>
          <button
            type="button"
            onClick={() => { onClose(); offerBlock.onBlock() }}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-status-danger text-[16px] font-semibold text-white active:bg-status-danger-strong"
            data-testid="report-block-offer-yes"
          >
            {t('safety.report.blockOffer.block', { name: offerBlock.name })}
          </button>
          <button type="button" onClick={onClose} className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-ink-1">
            {t('safety.report.blockOffer.notNow')}
          </button>
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title}>
      <div className="flex flex-col gap-3.5 px-5 pb-5 pt-1" data-testid="report-sheet">
        <div className="pt-1">
          <h2 className="text-[20px] font-bold leading-7 text-ink-1">{title}</h2>
          <p className="mt-1 text-row text-ink-2">{t('safety.report.intro')}</p>
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped" role="radiogroup" aria-label={t('safety.report.reasonLabel')}>
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
                {reportReasonLabel(r.value)}
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
          <span className="text-caption font-semibold text-ink-2">{t('safety.report.noteLabel')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={REPORT_NOTE_MAX}
            placeholder={t('safety.report.notePlaceholder')}
            className="w-full resize-none rounded-card bg-surface-grouped px-3.5 py-3 text-[15px] leading-[21px] text-ink-1 outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
          />
        </label>
        <button
          type="button"
          disabled={!reason || sending}
          onClick={() => void submit()}
          className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40"
        >
          {sending ? t('safety.report.sending') : t('safety.report.send')}
        </button>
        <button type="button" onClick={onClose} className="py-1 text-body font-semibold text-hockia-primary">{t('safety.report.cancel')}</button>
      </div>
    </BottomSheet>
  )
}
