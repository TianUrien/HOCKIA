import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { BENEFIT_TILES } from '@/lib/opportunityCopy'
import { DURATION_OPTIONS, PACKAGE_KEYS, PAY_OPTIONS } from '@/lib/postRole'
import {
  OFFER_MAX_DAYS,
  OFFER_NOTE_MAX,
  addDays,
  offerDraftFromOffer,
  offerDraftFromRole,
  offerPackageLine,
  offerPayLine,
  offerStartLine,
  openUntilError,
  shortDay,
  toDayString,
  type OfferDraft,
  type OfferRole,
  type OfferRow,
} from '@/lib/signing'
import { Chips, Segments } from './roleFormUi'
import { cn } from '@/lib/utils'

/**
 * D4.2 · Make an offer (Figma 390:249; DEV NOTE 391:28). Filled in from the
 * role, editable for this player: start and length, pay (the same field as
 * Post a role, optional), package, open until (a real deadline, today up to
 * 90 days ahead) and an optional note. It records the terms, not a contract,
 * and says so. Send → make_offer: the offer card lands in the conversation
 * and the player is notified. With a live offer, the sheet starts from it
 * and sending makes a new version.
 */
interface Props {
  open: boolean
  firstName: string
  roleLabel: string
  role: OfferRole | null
  /** The live offer being edited, if any. */
  current: OfferRow | null
  busy: boolean
  onClose: () => void
  onSend: (draft: OfferDraft) => void
}

type Field = 'start' | 'pay' | 'package' | 'openUntil' | null

function Row({ label, value, open, onToggle, children, testId }: { label: string; value: string; open: boolean; onToggle?: () => void; children?: ReactNode; testId: string }) {
  return (
    <div>
      <button type="button" onClick={onToggle} disabled={!onToggle} aria-expanded={onToggle ? open : undefined} className="flex min-h-[44px] w-full items-center gap-3 px-3.5 py-2.5 text-left disabled:cursor-default" data-testid={testId}>
        <span className="shrink-0 text-[15px] text-ink-2">{label}</span>
        <span className="min-w-0 flex-1 text-right text-[15px] text-ink-1">{value}</span>
        {onToggle && <ChevronRight className={cn('h-4 w-4 shrink-0 text-ink-4 transition-transform', open && 'rotate-90')} strokeWidth={2} aria-hidden="true" />}
      </button>
      {open && children && <div className="px-3.5 pb-3">{children}</div>}
    </div>
  )
}

const Divider = () => <div className="ml-3.5 h-[0.5px] bg-line" />

export default function OfferSheet({ open, firstName, roleLabel, role, current, busy, onClose, onSend }: Props) {
  const [draft, setDraft] = useState<OfferDraft | null>(null)
  const [field, setField] = useState<Field>(null)

  // Fresh draft each time the sheet opens: the live offer, else the role's defaults.
  useEffect(() => {
    if (!open) { setDraft(null); setField(null); return }
    // Only on open: a background refetch must not wipe what the club typed.
    if (draft === null) setDraft(current ? offerDraftFromOffer(current) : role ? offerDraftFromRole(role) : null)
  }, [open, current, role, draft])

  const packageOptions = useMemo(() => {
    const extra = (draft?.package ?? []).filter((p) => !(PACKAGE_KEYS as readonly string[]).includes(p.toLowerCase()))
    return [
      ...PACKAGE_KEYS.map((k) => ({ value: k as string, label: BENEFIT_TILES[k]?.label ?? k })),
      ...extra.map((p) => ({ value: p, label: p })),
    ]
  }, [draft?.package])

  if (!draft) return <BottomSheet open={open} onClose={onClose} ariaLabel={`Offer to ${firstName}`}><div className="h-40" /></BottomSheet>

  const set = <K extends keyof OfferDraft>(k: K, v: OfferDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const toggle = (f: Field) => setField((x) => (x === f ? null : f))
  const dateError = openUntilError(draft.openUntil)
  const today = toDayString(new Date())
  const maxDay = toDayString(addDays(new Date(), OFFER_MAX_DAYS))

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={`Offer to ${firstName}`}>
      <div className="overflow-y-auto px-5 pb-3 pt-1" data-testid="offer-sheet">
        <h2 className="text-[22px] font-bold leading-7 tracking-[-0.2px] text-ink-1">Offer to {firstName}</h2>
        <p className="mt-1 text-[14px] leading-5 text-ink-2">Filled in from your role. Change anything that’s different for {firstName}.</p>

        <div className="mt-3.5 overflow-hidden rounded-2xl bg-surface-grouped">
          <Row label="Role" value={roleLabel} open={false} testId="offer-row-role" />
          <Divider />
          <Row label="Start" value={offerStartLine(draft.startDate, draft.length) ?? 'Not set'} open={field === 'start'} onToggle={() => toggle('start')} testId="offer-row-start">
            <div className="flex gap-2">
              <input type="date" value={draft.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || null)} aria-label="Start date" className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-white px-2.5 text-[15px] text-ink-1" />
              <select value={draft.length ?? ''} onChange={(e) => set('length', e.target.value || null)} aria-label="Length" className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-white px-2 text-[15px] text-ink-1">
                <option value="">Length</option>
                {[...new Set([...(draft.length && !DURATION_OPTIONS.includes(draft.length) ? [draft.length] : []), ...DURATION_OPTIONS])].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </Row>
          <Divider />
          <Row label="Pay" value={offerPayLine(draft.pay) ?? 'Not stated'} open={field === 'pay'} onToggle={() => toggle('pay')} testId="offer-row-pay">
            <Segments label="Pay" value={PAY_OPTIONS.some((o) => o.value === draft.pay) ? draft.pay as (typeof PAY_OPTIONS)[number]['value'] : null} options={PAY_OPTIONS} onChange={(v) => set('pay', draft.pay === v ? null : v)} />
          </Row>
          <Divider />
          <Row label="Package" value={offerPackageLine(draft.package) ?? 'None'} open={field === 'package'} onToggle={() => toggle('package')} testId="offer-row-package">
            <Chips
              label="Package"
              values={draft.package}
              options={packageOptions}
              onToggle={(v) => set('package', draft.package.includes(v) ? draft.package.filter((x) => x !== v) : [...draft.package, v])}
            />
          </Row>
          <Divider />
          <Row label="Open until" value={shortDay(draft.openUntil) ?? 'Choose a date'} open={field === 'openUntil'} onToggle={() => toggle('openUntil')} testId="offer-row-open-until">
            <input type="date" value={draft.openUntil} min={today} max={maxDay} onChange={(e) => set('openUntil', e.target.value)} aria-label="Open until" className="h-10 w-full rounded-[10px] border border-line bg-white px-2.5 text-[15px] text-ink-1" />
          </Row>
        </div>
        {dateError && <p className="mt-2 text-secondary text-ink-2" data-testid="offer-date-error">{dateError}</p>}

        <textarea
          value={draft.note}
          onChange={(e) => set('note', e.target.value.slice(0, OFFER_NOTE_MAX))}
          rows={2}
          placeholder="Add a note (optional)"
          aria-label="Note (optional)"
          className="mt-3 w-full resize-none rounded-[14px] border border-line px-3.5 py-3 text-[15px] text-ink-1 outline-none placeholder:text-ink-3 focus:border-hockia-primary"
          data-testid="offer-note"
        />
        <p className="mt-2 text-caption leading-4 text-ink-2">An offer on Hockia sets out what you’re offering. The contract itself is between your club and the player.</p>

        <button
          type="button"
          onClick={() => onSend(draft)}
          disabled={busy || !!dateError}
          className="mt-3.5 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-50"
          data-testid="offer-send"
        >
          {busy ? 'Sending…' : current ? 'Send updated offer' : 'Send offer'}
        </button>
      </div>
    </BottomSheet>
  )
}
