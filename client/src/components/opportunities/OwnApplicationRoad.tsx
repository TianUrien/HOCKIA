import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Minus } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useToastStore } from '@/lib/toast'
import { useOwnOfferMade, useSigningActions } from '@/hooks/useSigning'
import { WITHDRAW_TITLE, canWithdraw, playerRoadHint, playerRoadSteps, withdrawBody } from '@/lib/signing'
import { cn } from '@/lib/utils'

/**
 * The applicant's own application on a role page (phone and desktop): the
 * road Shortlisted → Offer → Signed once shortlisted (Figma D4 brief 401:29;
 * DEV NOTE 391:26 — their own status only, never fit or other applicants),
 * the way to the offer (the chat, scrolled to the offer card) or to Confirm
 * signing, and Withdraw application with a confirm step
 * (withdraw_application; final, the club sees "Withdrawn" and is told).
 */
interface Props {
  applicationId: string
  status: string
  /** Opens the conversation with the club. */
  onMessage?: () => void
  /** "See the offer": the conversation scrolled to THIS application's newest offer card (falls back to onMessage). */
  onSeeOffer?: (applicationId: string) => void
  onChanged: (status: string) => void
  className?: string
}

export function PlayerRoadSteps({ status, offerMade = null, className }: { status: string; offerMade?: boolean | null; className?: string }) {
  const steps = playerRoadSteps(status, offerMade)
  if (!steps) return null
  return (
    <ol className={cn('flex items-center gap-1.5', className)} aria-label="Your application" data-testid="player-road-steps">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <span className={cn('h-px w-4', s.done ? 'bg-positive' : 'bg-line')} aria-hidden="true" />}
          <span
            className={cn('flex items-center gap-1 text-caption font-semibold', s.done ? 'text-positive' : s.current ? 'text-hockia-primary' : 'text-ink-3')}
            data-done={s.done}
            data-current={s.current ? 'true' : undefined}
            data-skipped={s.skipped ? 'true' : undefined}
          >
            {s.done
              ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              : s.skipped
                ? <Minus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                : <span className={cn('h-2.5 w-2.5 rounded-full border-[1.5px]', s.current ? 'border-hockia-primary' : 'border-ink-4')} aria-hidden="true" />}
            {s.label}{s.skipped ? ' · skipped' : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function OwnApplicationRoad({ applicationId, status, onMessage, onSeeOffer, onChanged, className }: Props) {
  const { withdrawApplication } = useSigningActions()
  const [confirming, setConfirming] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const addToast = useToastStore((s) => s.addToast)
  const hint = playerRoadHint(status)
  // Only a signing needs to know whether an offer was part of it.
  const offerMade = useOwnOfferMade(applicationId, status === 'signed_pending_confirmation' || status === 'signed')
  const steps = playerRoadSteps(status, offerMade)
  const withdrawable = canWithdraw(status)
  const seeOffer = onSeeOffer ? () => onSeeOffer(applicationId) : onMessage
  if (!steps && !withdrawable) return null

  const withdraw = async () => {
    setWithdrawing(true)
    const res = await withdrawApplication(applicationId)
    setWithdrawing(false)
    if (!res.ok) {
      addToast(res.error || 'Couldn’t withdraw. Please try again.', 'error')
      return
    }
    setConfirming(false)
    onChanged('withdrawn')
  }

  return (
    <section className={cn('rounded-card border border-line bg-white p-3.5', className)} data-testid="own-application-road">
      {steps && (
        <>
          <p className="text-secondary font-semibold text-ink-2">Your application</p>
          <PlayerRoadSteps status={status} offerMade={offerMade} className="mt-2" />
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
          {status === 'offered' && seeOffer && (
            <button type="button" onClick={seeOffer} className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-hockia-primary text-row font-semibold text-white" data-testid="own-application-see-offer">
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
      <BottomSheet open={confirming} onClose={() => setConfirming(false)} ariaLabel={WITHDRAW_TITLE}>
        <div className="px-5 pb-2 pt-2 text-center" data-testid="withdraw-application-confirm">
          <h2 className="text-[22px] font-bold leading-7 tracking-[-0.2px] text-ink-1">{WITHDRAW_TITLE}</h2>
          <p className="mt-2 text-[15px] leading-[21px] text-ink-2">{withdrawBody(status)}</p>
          <button type="button" onClick={() => void withdraw()} disabled={withdrawing} className="mt-5 flex h-[50px] w-full items-center justify-center rounded-full bg-red-600 text-[16px] font-semibold text-white disabled:opacity-60" data-testid="withdraw-application-yes">
            {withdrawing ? 'Withdrawing…' : 'Withdraw'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-ink-1">
            Keep it
          </button>
        </div>
      </BottomSheet>
    </section>
  )
}
