import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { firstNameOf, inviteRoleLabel } from '@/lib/invites'
import { DECLINE_REASON_MAX, offerCardState, offerPackageLine, offerPayLine, offerStartLine } from '@/lib/signing'
import { offerCardKey, useOfferCard, useSigningActions, type OfferCardData } from '@/hooks/useSigning'
import { cn } from '@/lib/utils'

/**
 * D4.3 · Offer in chat (Figma 390:557; DEV NOTE 391:32). The offer lands in
 * the conversation, where questions happen anyway. It renders from
 * opportunity_offers: the role, start, pay and package, the club's note,
 * then Decline / Accept in one tap. Nothing about other applicants or fit.
 * Accept → respond_offer(accept), the club is told. Decline → an optional
 * reason, respond_offer(decline), the application goes back to shortlisted
 * and the club is told. Past open-until → the card greys out.
 *
 * The club (sender) sees the same card with a grey status line instead of
 * the actions. "Open until" turns amber in its last 5 days only for the
 * player, who must answer (founder ruling: amber only when the viewer acts).
 */
interface Props {
  offerId: string
  /** The viewer sent the card (the club); otherwise the viewer is the player. */
  isMine: boolean
  fallbackText: string
}

export default function OfferCard({ offerId, isMine, fallbackText }: Props) {
  const queryClient = useQueryClient()
  const { data, loading } = useOfferCard(offerId)
  const { respondOffer, busy } = useSigningActions()
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  if (loading) {
    return <div className="h-[230px] w-full animate-pulse rounded-[18px] bg-surface-grouped" data-testid="offer-card-loading" />
  }
  if (!data) {
    return (
      <div className="rounded-[18px] bg-surface-grouped px-3.5 py-2.5 text-[15px] leading-5 text-ink-1">
        <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>{fallbackText}</p>
      </div>
    )
  }

  const { offer, role } = data
  const state = offerCardState({
    viewer: isMine ? 'club' : 'player',
    status: offer.status,
    openUntil: offer.open_until,
    playerFirstName: firstNameOf(data.playerName, 'The player'),
  })
  const facts: [string, string | null][] = [
    ['Start', offerStartLine(offer.start_date, offer.length)],
    ['Pay', offerPayLine(offer.pay)],
    ['Package', offerPackageLine(offer.package)],
  ]
  const patch = (status: OfferCardData['offer']['status']) =>
    queryClient.setQueryData<OfferCardData | null>(offerCardKey(offer.id), (d) => (d ? { ...d, offer: { ...d.offer, status } } : d))

  const accept = async () => {
    const res = await respondOffer(offer.id, true, null)
    if (res.ok) patch('accepted')
  }
  const decline = async () => {
    const res = await respondOffer(offer.id, false, reason)
    if (res.ok) {
      patch('declined')
      setDeclining(false)
      setReason('')
    }
  }
  const dim = state.muted ? 'text-ink-3' : 'text-ink-1'

  return (
    <div
      className={cn('w-full rounded-[18px] border-[1.5px] bg-white p-4', state.muted ? 'border-line' : 'border-hockia-primary')}
      data-testid="offer-card"
      data-state={offer.status}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('flex items-center gap-1.5 text-[13px] font-semibold', state.muted ? 'text-ink-3' : 'text-hockia-primary')}>
          <FileText className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> Offer
        </span>
        {state.deadline && (
          <span
            className={cn('rounded-full px-2.5 py-1 text-caption font-semibold', state.deadlineTone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-surface-grouped text-ink-2')}
            data-testid="offer-deadline"
            data-tone={state.deadlineTone}
          >
            {state.deadline}
          </span>
        )}
      </div>
      <h3 className={cn('pt-2 text-[18px] font-bold leading-6 tracking-[-0.2px]', dim)}>{inviteRoleLabel(role)}</h3>
      <dl className="mt-2 flex flex-col gap-2">
        {facts.filter(([, v]) => !!v).map(([label, value]) => (
          <div key={label} className="flex gap-3 text-[14px] leading-5">
            <dt className="w-[68px] shrink-0 text-ink-2">{label}</dt>
            <dd className={cn('min-w-0 flex-1', dim)}>{value}</dd>
          </div>
        ))}
      </dl>
      {offer.note && (
        <p className={cn('mt-3 whitespace-pre-wrap break-words rounded-[14px] bg-surface-grouped px-3.5 py-3 text-[14px] leading-5', dim)} style={{ overflowWrap: 'anywhere' }} data-testid="offer-card-note">
          {offer.note}
        </p>
      )}

      {state.actionable ? (
        <>
          <div className="mt-3.5 flex gap-2.5">
            <button type="button" onClick={() => setDeclining(true)} disabled={busy} className="flex h-11 flex-1 items-center justify-center rounded-full border border-line bg-white text-[16px] font-semibold text-ink-1 disabled:opacity-60" data-testid="offer-decline">
              Decline
            </button>
            <button type="button" onClick={() => void accept()} disabled={busy} className="flex h-11 flex-1 items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="offer-accept">
              Accept
            </button>
          </div>
          <p className="mt-2.5 text-caption text-ink-2">Questions? Reply here before you decide.</p>
        </>
      ) : state.line ? (
        <span className="mt-3.5 inline-flex items-center rounded-full bg-surface-grouped px-3 py-1.5 text-secondary font-semibold text-ink-2" data-testid="offer-card-status">
          {state.line}
        </span>
      ) : null}

      <BottomSheet open={declining} onClose={() => setDeclining(false)} ariaLabel="Decline the offer">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-[22px] font-bold leading-7 text-ink-1">Decline this offer?</h2>
          <p className="mt-1 text-row text-ink-2">The club will be told. You can say why — it’s optional.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, DECLINE_REASON_MAX))}
            rows={3}
            placeholder="Add a reason (optional)"
            aria-label="Reason (optional)"
            className="mt-3 w-full resize-none rounded-[14px] border border-line px-3.5 py-3 text-row text-ink-1 outline-none placeholder:text-ink-3 focus:border-hockia-primary"
            data-testid="offer-decline-reason"
          />
          <button type="button" onClick={() => void decline()} disabled={busy} className="mt-3 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="offer-decline-confirm">
            Decline offer
          </button>
          <button type="button" onClick={() => setDeclining(false)} className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-ink-1">
            Keep the offer
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
