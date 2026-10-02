import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useSigningActions } from '@/hooks/useSigning'
import { WITHDRAW_TITLE, canWithdraw, playerRoadHint, playerRoadSteps, withdrawBody } from '@/lib/signing'
import { cn } from '@/lib/utils'

/**
 * The applicant's own application on a role page (phone and desktop): the
 * road Shortlisted → Offer → Signed once shortlisted (Figma D4 brief 401:29;
 * DEV NOTE 391:26 — their own status only, never fit or other applicants),
 * the way to the offer (the chat) or to Confirm signing, and Withdraw
 * application with a confirm step (withdraw_application; final, the club
 * sees "Withdrawn" and is told).
 */
interface Props {
  applicationId: string
  status: string
  /** Opens the conversation with the club (where the offer card lives). */
  onMessage?: () => void
  onChanged: (status: string) => void
  className?: string
}

export function PlayerRoadSteps({ status, className }: { status: string; className?: string }) {
  const steps = playerRoadSteps(status)
  if (!steps) return null
  return (
    <ol className={cn('flex items-center gap-1.5', className)} aria-label="Your application" data-testid="player-road-steps">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <span className={cn('h-px w-4', s.done ? 'bg-positive' : 'bg-line')} aria-hidden="true" />}
          <span className={cn('flex items-center gap-1 text-caption font-semibold', s.done ? 'text-positive' : 'text-ink-3')} data-done={s.done}>
            {s.done
              ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              : <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink-4" aria-hidden="true" />}
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function OwnApplicationRoad({ applicationId, status, onMessage, onChanged, className }: Props) {
  const { withdrawApplication } = useSigningActions()
  const [confirming, setConfirming] = useState(false)
  const hint = playerRoadHint(status)
  const steps = playerRoadSteps(status)
  const withdrawable = canWithdraw(status)
  if (!steps && !withdrawable) return null

  const withdraw = async () => {
    const res = await withdrawApplication(applicationId)
    if (!res.ok) throw new Error(res.error)
    onChanged('withdrawn')
  }

  return (
    <section className={cn('rounded-card border border-line bg-white p-3.5', className)} data-testid="own-application-road">
      {steps && (
        <>
          <p className="text-secondary font-semibold text-ink-2">Your application</p>
          <PlayerRoadSteps status={status} className="mt-2" />
          {hint && <p className="mt-2 text-secondary leading-[18px] text-ink-2">{hint}</p>}
          {status === 'signed_pending_confirmation' && (
            <Link
              to={`/applications/${applicationId}/signing`}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-hockia-primary text-row font-semibold text-white"
              data-testid="own-application-confirm-signing"
            >
              Confirm signing
            </Link>
          )}
          {status === 'offered' && onMessage && (
            <button type="button" onClick={onMessage} className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-hockia-primary text-row font-semibold text-white" data-testid="own-application-see-offer">
              See the offer
            </button>
          )}
        </>
      )}
      {withdrawable && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={cn('text-secondary font-semibold text-ink-2 underline-offset-2 hover:underline', steps ? 'mt-3' : '')}
          data-testid="withdraw-application"
        >
          Withdraw application
        </button>
      )}
      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={withdraw}
        title={WITHDRAW_TITLE}
        message={withdrawBody(status)}
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        variant="danger"
        testId="withdraw-application-confirm"
      />
    </section>
  )
}
