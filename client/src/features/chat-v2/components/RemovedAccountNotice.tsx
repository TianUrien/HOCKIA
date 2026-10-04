import { REPORT_MENU_LABEL } from '@/lib/report'
import { useReportAction } from '@/components/safety/useReportAction'
import { REMOVED_ACCOUNT_NOTICE, useIsRemovedAccount } from '../removedAccount'

interface RemovedAccountNoticeProps {
  participantId: string | null | undefined
  conversationId?: string
  /** False for a conversation that does not exist yet. */
  enabled?: boolean
}

/**
 * Neutral safety note at the top of a thread with a removed account: grey
 * surface, never red or amber (nothing here is the reader's fault or task).
 * "Report" opens the same sheet as the "…" menu in the chat header.
 */
export function RemovedAccountNotice({ participantId, conversationId, enabled = true }: RemovedAccountNoticeProps) {
  const removed = useIsRemovedAccount(participantId, enabled)
  const report = useReportAction({ targetId: participantId, subject: 'chat', contentId: conversationId })
  if (!removed) return null
  return (
    <div role="note" className="flex-shrink-0 border-b border-line bg-surface-muted px-4 py-3" data-testid="removed-account-notice">
      <p className="text-secondary text-ink-2">{REMOVED_ACCOUNT_NOTICE}</p>
      <button
        type="button"
        onClick={report.open}
        className="mt-1 -ml-1 flex h-9 items-center px-1 text-secondary font-semibold text-ink-1 underline underline-offset-2"
        data-testid="removed-account-report"
      >
        {REPORT_MENU_LABEL}
      </button>
      {report.sheet}
    </div>
  )
}
