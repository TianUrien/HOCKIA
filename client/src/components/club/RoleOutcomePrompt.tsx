import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { roleTitle } from '@/lib/opportunityCopy'
import { shortDayOf } from '@/lib/signing'
import { cn } from '@/lib/utils'
import { useClubT } from '@/i18n/ns/club'
import { EXPIRY_OUTCOMES, fetchOutcomeApplicants, fetchRoleOutcomeStates, nextRoleToAsk, saveRoleOutcome, trackRoleOutcomeAsked, type OutcomeApplicant, type RoleOutcome, type RoleOutcomeState } from '@/lib/roleOutcome'

/**
 * "Did you fill this place?" for a role that closed on its own (founder
 * rulings 2026-11-21, docs/product/proposals/recruiter-satisfaction.md).
 *
 * A one-line banner above the roles, never a pop-up: "Answer" opens the
 * question in a bottom sheet, the X closes the banner. One role per app
 * session, most recently closed first. A closed banner comes back once, 14
 * days later, and then the role is never asked about again. Neutral, not
 * amber: nothing is owed. The answer is private.
 */
export interface OutcomePromptRole {
  id: string
  title: string
  position?: string | null
  opportunity_type?: string | null
  closed_reason?: string | null
  closed_at?: string | null
}

const SESSION_KEY = 'hockia.roleOutcomeAsked'
function askedThisSession(): boolean {
  try { return window.sessionStorage.getItem(SESSION_KEY) === '1' } catch { return false }
}
function markAskedThisSession(): void {
  try { window.sessionStorage.setItem(SESSION_KEY, '1') } catch { /* private mode: the banner may show again on the next visit */ }
}

interface Props {
  recruiterId: string | null | undefined
  closed: OutcomePromptRole[]
  className?: string
}

export function RoleOutcomePrompt({ recruiterId, closed, className }: Props) {
  const t = useClubT()
  const [states, setStates] = useState<Map<string, RoleOutcomeState> | null>(null)
  // One question per app session: answering or closing one role never chains into the next.
  const [doneThisVisit, setDoneThisVisit] = useState(() => askedThisSession())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [picked, setPicked] = useState<RoleOutcome | null>(null)
  const [applicants, setApplicants] = useState<OutcomeApplicant[]>([])
  const [hiredId, setHiredId] = useState('')
  const [busy, setBusy] = useState(false)
  // The applicants of the role being asked about; awaited before offering to name one.
  const loading = useRef<Promise<OutcomeApplicant[]>>(Promise.resolve([]))

  useEffect(() => {
    if (!recruiterId) return
    let cancelled = false
    void fetchRoleOutcomeStates(recruiterId).then((found) => { if (!cancelled) setStates(found) })
    return () => { cancelled = true }
  }, [recruiterId])

  const role = useMemo(() => (states && !doneThisVisit ? nextRoleToAsk(closed, states) : null), [states, closed, doneThisVisit])
  const roleId = role?.id ?? null

  useEffect(() => {
    if (!roleId) return
    trackRoleOutcomeAsked(roleId, 'expiry')
    let cancelled = false
    loading.current = fetchOutcomeApplicants(roleId)
    void loading.current.then((rows) => { if (!cancelled) setApplicants(rows) })
    return () => { cancelled = true }
  }, [roleId])

  if (!role || !recruiterId) return null

  const save = async (outcome: RoleOutcome) => {
    if (busy) return
    setBusy(true)
    const dismissCount = outcome === 'skipped' ? (states?.get(role.id)?.dismissCount ?? 0) + 1 : 0
    await saveRoleOutcome({ roleId: role.id, recruiterId, outcome, via: 'expiry', hiredApplicationId: hiredId || null, dismissCount })
    // One question per session, whether or not the write landed: never a loop of prompts.
    markAskedThisSession()
    setSheetOpen(false)
    setDoneThisVisit(true)
    setBusy(false)
  }
  const pick = async (outcome: RoleOutcome) => {
    // "Someone from Hockia" can name the person first; the other answers save at once.
    // A fast tap waits for the applicants instead of skipping that step.
    if (outcome === 'filled_hockia' && (await loading.current).length > 0) { setPicked(outcome); return }
    void save(outcome)
  }
  const closedOn = role.closed_at ? shortDayOf(role.closed_at) : null
  const title = roleTitle({ position: role.position ?? null, title: role.title, opportunity_type: role.opportunity_type ?? null })

  return (
    <>
      <div className={cn('flex min-h-[56px] items-center gap-2 rounded-[16px] bg-surface-subtle py-1 pl-4 pr-1', className)} data-testid="role-outcome-banner">
        {/* The role on its own line, cut with an ellipsis when long, so the question is always whole. */}
        <div className="min-w-0 flex-1 py-1.5">
          <p className="truncate text-[15px] font-semibold leading-[20px] text-ink-1">{title}</p>
          <p className="text-secondary text-ink-2">{t('roleOutcome.banner')}</p>
        </div>
        <button type="button" onClick={() => { setPicked(null); setSheetOpen(true) }} className="flex h-9 shrink-0 items-center rounded-full bg-brand-soft px-4 text-[15px] font-semibold text-brand-primary" data-testid="role-outcome-answer">{t('roleOutcome.answer')}</button>
        <button type="button" disabled={busy} onClick={() => void save('skipped')} aria-label={t('roleOutcome.dismiss')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 disabled:opacity-50" data-testid="role-outcome-dismiss">
          <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} ariaLabel={t('roleOutcome.question')}>
        <div className="flex flex-col gap-3.5 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2" data-testid="role-outcome-sheet">
          <div>
            <h2 className="text-[22px] font-bold leading-[27px] tracking-[-0.13px] text-ink-1">{t('roleOutcome.question')}</h2>
            <p className="mt-1 text-secondary text-ink-2">{closedOn ? t('roleOutcome.context', { title, date: closedOn }) : t('roleOutcome.contextNoDate', { title })}</p>
          </div>
          {picked === 'filled_hockia' ? (
            <>
              <label className="flex flex-col gap-1.5 text-secondary text-ink-2">
                {t('closeRole.whoLabel')}
                <select value={hiredId} onChange={(e) => setHiredId(e.target.value)} className="h-12 w-full rounded-[12px] border border-line bg-white px-3 text-body text-ink-1" data-testid="role-outcome-who">
                  <option value="">{t('closeRole.whoNone')}</option>
                  {applicants.map((a) => <option key={a.applicationId} value={a.applicationId}>{a.name}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => void save('filled_hockia')} className="flex h-[52px] items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40" data-testid="role-outcome-save">{t('roleOutcome.save')}</button>
            </>
          ) : (
            <div className="flex flex-col gap-2.5" role="group" aria-label={t('roleOutcome.question')}>
              {EXPIRY_OUTCOMES.map((outcome) => (
                <button key={outcome} type="button" disabled={busy} onClick={() => void pick(outcome)} className="flex min-h-[52px] items-center rounded-[16px] bg-surface-subtle px-4 py-3 text-left text-[17px] leading-[22px] text-ink-1 disabled:opacity-50" data-testid={`role-outcome-${outcome}`}>
                  {t(`roleOutcome.options.${outcome}`)}
                </button>
              ))}
            </div>
          )}
          <p className="text-caption text-ink-3">{t('closeRole.privateNote')}</p>
        </div>
      </BottomSheet>
    </>
  )
}
