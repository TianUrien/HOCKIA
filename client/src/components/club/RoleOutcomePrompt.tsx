import { useEffect, useMemo, useRef, useState } from 'react'
import { roleTitle } from '@/lib/opportunityCopy'
import { shortDayOf } from '@/lib/signing'
import { cn } from '@/lib/utils'
import { useClubT } from '@/i18n/ns/club'
import { EXPIRY_OUTCOMES, fetchAnsweredRoleIds, fetchOutcomeApplicants, nextRoleToAsk, saveRoleOutcome, trackRoleOutcomeAsked, type OutcomeApplicant, type RoleOutcome } from '@/lib/roleOutcome'

/**
 * "Did you fill this place?" for a role that closed on its own (founder
 * ruling 2026-11-21, docs/product/proposals/recruiter-satisfaction.md).
 * One role per visit, most recently closed first, once per role: an answer
 * or "Not now" is recorded and the role is never asked about again. A
 * neutral card, not amber: nothing is owed. The answer is private.
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
  try { window.sessionStorage.setItem(SESSION_KEY, '1') } catch { /* private mode: the prompt may show again on the next visit */ }
}

interface Props {
  recruiterId: string | null | undefined
  closed: OutcomePromptRole[]
  className?: string
}

export function RoleOutcomePrompt({ recruiterId, closed, className }: Props) {
  const t = useClubT()
  const [answered, setAnswered] = useState<Set<string> | null>(null)
  // One question per app session: answering or skipping one role never chains into the next.
  const [doneThisVisit, setDoneThisVisit] = useState(() => askedThisSession())
  const [picked, setPicked] = useState<RoleOutcome | null>(null)
  const [applicants, setApplicants] = useState<OutcomeApplicant[]>([])
  const [hiredId, setHiredId] = useState('')
  const [busy, setBusy] = useState(false)
  // The applicants of the role being asked about; awaited before offering to name one.
  const loading = useRef<Promise<OutcomeApplicant[]>>(Promise.resolve([]))

  useEffect(() => {
    if (!recruiterId) return
    let cancelled = false
    void fetchAnsweredRoleIds(recruiterId).then((ids) => { if (!cancelled) setAnswered(ids) })
    return () => { cancelled = true }
  }, [recruiterId])

  const role = useMemo(() => (answered && !doneThisVisit ? nextRoleToAsk(closed, answered) : null), [answered, closed, doneThisVisit])
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
    await saveRoleOutcome({ roleId: role.id, recruiterId, outcome, via: 'expiry', hiredApplicationId: hiredId || null })
    // One question per visit, whether or not the write landed: never a loop of prompts.
    markAskedThisSession()
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
    <section className={cn('flex flex-col gap-3 rounded-[16px] bg-surface-subtle px-4 py-3.5', className)} aria-labelledby="role-outcome-title" data-testid="role-outcome-prompt">
      <div>
        <h2 id="role-outcome-title" className="text-[16px] font-semibold leading-[21px] text-ink-1">{t('roleOutcome.question')}</h2>
        <p className="mt-0.5 text-secondary text-ink-2">{closedOn ? t('roleOutcome.context', { title, date: closedOn }) : t('roleOutcome.contextNoDate', { title })}</p>
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
          <button type="button" disabled={busy} onClick={() => void save('filled_hockia')} className="flex h-11 items-center justify-center rounded-full bg-brand-soft px-5 text-[16px] font-semibold text-brand-primary disabled:opacity-50" data-testid="role-outcome-save">{t('roleOutcome.save')}</button>
        </>
      ) : (
        <div className="flex flex-col gap-2" role="group" aria-labelledby="role-outcome-title">
          {EXPIRY_OUTCOMES.map((outcome) => (
            <button key={outcome} type="button" disabled={busy} onClick={() => void pick(outcome)} className="flex min-h-[44px] items-center rounded-[12px] bg-white px-3.5 py-2.5 text-left text-[16px] leading-[21px] text-ink-1 disabled:opacity-50" data-testid={`role-outcome-${outcome}`}>
              {t(`roleOutcome.options.${outcome}`)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-ink-3">{t('closeRole.privateNote')}</p>
        <button type="button" disabled={busy} onClick={() => void save('skipped')} className="-my-2 flex h-11 shrink-0 items-center text-[15px] text-ink-2 disabled:opacity-50" data-testid="role-outcome-skip">{t('roleOutcome.notNow')}</button>
      </div>
    </section>
  )
}
