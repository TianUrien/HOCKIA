import { useCallback } from 'react'
import { holdDecision } from '@/lib/pendingDecisions'
import { patchRoleApplicantStatus, type Applicant } from '@/hooks/useRoleApplicants'
import { useUndoToast } from '@/lib/undoToast'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { bulkDecisionToast, firstWord, personalDeclineNote } from '@/lib/declineNotes'
import type { Json } from '@/lib/database.types'

/**
 * Club speed · answer several applicants together (Figma 05 CS4 204:1119 /
 * CS5 204:1194). Each application gets its own held decision — the same
 * write, notification and email as one-by-one review — and one toast undoes
 * them all within the usual window. A decline sends every player the shared
 * note with their own first name.
 */
export function useBulkDecisions(roleId: string) {
  const showUndo = useUndoToast((s) => s.show)
  const addToast = useToastStore((s) => s.addToast)

  const run = useCallback((rows: Applicant[], status: 'maybe' | 'rejected', decline?: { reason: string; body: string }) => {
    if (rows.length === 0) return
    const prev = new Map(rows.map((a) => [a.applicationId, a.status]))
    let failed = 0
    let refused = 0
    let settled = 0
    const done = () => {
      settled += 1
      if (settled < rows.length) return
      if (refused) addToast(refused === 1 ? '1 application changed before your decision was saved, so it was left as it is.' : `${refused} applications changed before your decision was saved, so they were left as they are.`, 'info')
      if (failed) addToast(failed === 1 ? 'Couldn’t save 1 decision. Please try again.' : `Couldn’t save ${failed} decisions. Please try again.`, 'error')
    }
    for (const a of rows) {
      const id = a.applicationId
      const before = prev.get(id) ?? a.status
      const onDone = (ok: boolean, withdrawn?: boolean, movedOn?: boolean) => {
        if (ok) trackDbEvent('applicant_status_change', 'application', id, { new_status: status, reason: decline?.reason ?? null, bulk: true, count: rows.length })
        else if (withdrawn) { patchRoleApplicantStatus(roleId, id, 'withdrawn'); refused += 1 }
        else if (movedOn) { patchRoleApplicantStatus(roleId, id, before); refused += 1 }
        else { patchRoleApplicantStatus(roleId, id, before); failed += 1 }
        done()
      }
      if (status === 'rejected' && decline) {
        holdDecision({ kind: 'decline', applicationId: id, reason: decline.reason, message: personalDeclineNote(firstWord(a.person.fullName), decline.body) }, onDone)
      } else {
        holdDecision({ kind: 'status', applicationId: id, status: 'maybe', metadata: { ...a.metadata, status_reason: null } as unknown as Json }, onDone)
      }
      patchRoleApplicantStatus(roleId, id, status)
    }
    const ids = rows.map((a) => a.applicationId)
    showUndo({
      applicationId: ids[0],
      applicationIds: ids,
      text: bulkDecisionToast(rows.length, status),
      onUndo: (undone) => undone.forEach((id) => patchRoleApplicantStatus(roleId, id, prev.get(id) ?? 'pending')),
    })
  }, [roleId, showUndo, addToast])

  return {
    maybe: (rows: Applicant[]) => run(rows, 'maybe'),
    decline: (rows: Applicant[], reason: string, body: string) => run(rows, 'rejected', { reason, body }),
  }
}

