/**
 * AdminBrandOffers Page
 *
 * Brand offers review queue (Figma "08 · Brands", P1: A1 queue, A2 reject
 * dialog, A3 empty). Oldest first; every offer is checked before members see
 * it. A reason is required to reject and the brand sees it word for word.
 */

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/lib/toast'
import { useAdminBrandOfferCounts, useAdminBrandOffers } from '@/hooks/useBrandOffers'
import { OfferPreviewCard, OfferThumb } from '@/components/brands/offers/OfferParts'
import { useCountryNames } from '@/hooks/useCountryNames'
import {
  OFFER_LIVE_LIMIT,
  OFFER_ROLES,
  audienceLine,
  offerErrorMessage,
  shortDate,
  type AdminBrandOffer,
  type AdminOfferTab,
  type OfferFields,
} from '@/lib/brandOffers'

const TABS: { value: AdminOfferTab; label: string }[] = [
  { value: 'to_review', label: 'To review' },
  { value: 'not_approved', label: 'Rejected' },
  { value: 'live', label: 'Live' },
]

const CHECKS = [
  'Targets by location only, never nationality',
  'Says exactly what members get; no claims like "best" or "cheapest"',
  'The link opens and matches the offer',
  'Fit for adults; nothing aimed at under-18s',
  'Allowed category (no betting, alcohol or tobacco)',
]

/** A2 common reasons: each fills the reason box with a sentence the brand can act on. */
const REASONS: { label: string; text: string }[] = [
  { label: 'A claim we can’t check', text: 'Please remove claims we can’t check, like "best" or "cheapest". Say exactly what members get instead.' },
  { label: 'Link doesn’t open', text: 'The link doesn’t open or doesn’t match the offer. Please check it and send the offer again.' },
  { label: 'Targets nationality', text: 'Offers can reach members only by where they live, never by nationality. Please change the audience.' },
  { label: 'Not allowed category', text: 'This category isn’t allowed on HOCKIA (for example betting, alcohol or tobacco).' },
  { label: 'Photo with text', text: 'Please use a real photo of the product or service, without text on the image.' },
]

/** What members will see: a pending change wins over the live copy. */
function shownFields(o: AdminBrandOffer): OfferFields {
  const base: OfferFields = {
    title: o.title, body: o.body, image_url: o.image_url, link_url: o.link_url, country_ids: o.country_ids ?? [],
    area: o.area, roles: o.roles ?? [], starts_at: o.starts_at, ends_at: o.ends_at,
  }
  return { ...base, ...(o.pending ?? {}) } as OfferFields
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `${mins} min`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`
}


export function AdminBrandOffers() {
  const [tab, setTab] = useState<AdminOfferTab>('to_review')
  const counts = useAdminBrandOfferCounts()
  const { offers, isLoading, review } = useAdminBrandOffers(tab)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = offers.find((o) => o.id === selectedId) ?? offers[0] ?? null

  useEffect(() => { setSelectedId(null) }, [tab])

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(320px,580px)_minmax(0,1fr)]" data-testid="admin-brand-offers">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Offers to review</h1>
        <p className="mt-2 text-gray-500">Oldest first. Every offer is checked before members see it.</p>
        <div className="mt-5 inline-flex rounded-full bg-gray-100 p-1" role="tablist" aria-label="Offer queue">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', tab === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}
            >
              {t.label} · {counts[t.value]}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {isLoading ? (
            [0, 1, 2].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-[20px] bg-white" />)
          ) : offers.length === 0 ? (
            <EmptyQueue tab={tab} />
          ) : (
            offers.map((o) => (
              <QueueRow key={o.id} offer={o} active={selected?.id === o.id} onClick={() => setSelectedId(o.id)} />
            ))
          )}
        </div>
      </div>

      {selected ? (
        <ReviewPanel
          key={selected.id}
          offer={selected}
          canReview={tab === 'to_review'}
          busy={review.isPending}
          onReview={(decision, note) => review.mutateAsync({ id: selected.id, decision, note })}
        />
      ) : null}
    </div>
  )
}

function EmptyQueue({ tab }: { tab: AdminOfferTab }) {
  const copy = {
    to_review: { h: 'Nothing to review', p: 'New offers and changes from brands appear here, oldest first.' },
    not_approved: { h: 'No rejected offers', p: 'Offers you reject stay here until the brand sends them again.' },
    live: { h: 'No live offers', p: 'Approved offers appear here while members can see them.' },
  }[tab]
  return (
    <div className="rounded-[24px] bg-white p-8 text-center" data-testid="admin-offers-empty">
      <Inbox className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
      <p className="mt-3 text-lg font-semibold text-gray-900">{copy.h}</p>
      <p className="mt-1 text-gray-500">{copy.p}</p>
    </div>
  )
}

function QueueRow({ offer, active, onClick }: { offer: AdminBrandOffer; active: boolean; onClick: () => void }) {
  const names = useCountryNames()
  const f = shownFields(offer)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex w-full items-center gap-4 rounded-[20px] bg-white p-4 text-left shadow-sm', active && 'ring-2 ring-hockia-primary')}
      data-testid="admin-offer-row"
    >
      <OfferThumb url={f.image_url} className="h-16 w-16 shrink-0 rounded-[14px]" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-gray-500">{offer.brand_name}{offer.pending ? ' · change' : ''}</span>
        <span className="block truncate text-lg font-semibold text-gray-900">{f.title}</span>
        <span className="block truncate text-sm text-gray-500">{audienceLine(names(f.country_ids), f.roles)}</span>
      </span>
      <span className="self-start text-sm text-gray-500">{ago(offer.submitted_at)}</span>
    </button>
  )
}

interface ReviewPanelProps {
  offer: AdminBrandOffer
  canReview: boolean
  busy: boolean
  onReview: (decision: 'approve' | 'reject', note: string | null) => Promise<unknown>
}

function ReviewPanel({ offer, canReview, busy, onReview }: ReviewPanelProps) {
  const names = useCountryNames()
  const addToast = useToastStore((s) => s.addToast)
  const f = shownFields(offer)
  const [checked, setChecked] = useState<boolean[]>(CHECKS.map(() => false))
  const [note, setNote] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  // Approve with checks left: show which ones instead of a silent disabled button.
  const [showMissing, setShowMissing] = useState(false)
  const allChecked = checked.every(Boolean)
  const countries = names(f.country_ids)
  const who = f.roles.map((r) => OFFER_ROLES.find((x) => x.value === r)?.label ?? r).join(', ')

  const meta = useMemo(() => {
    const parts = [offer.brand_name]
    if (offer.submitted_at) parts.push(`sent ${ago(offer.submitted_at)} ago`)
    if (offer.pending) parts.push('change to a live offer')
    else if (offer.brand_offer_count <= 1) parts.push('first offer from this brand')
    return parts.join(' · ')
  }, [offer])

  const decide = async (decision: 'approve' | 'reject', reason: string | null) => {
    try {
      await onReview(decision, reason)
      addToast(decision === 'approve' ? 'Approved. The brand has been told.' : 'Rejected. The brand sees your reason.', 'success')
      setRejectOpen(false)
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
    }
  }

  const host = (() => { try { return f.link_url ? new URL(f.link_url).host + new URL(f.link_url).pathname.replace(/\/$/, '') : '' } catch { return f.link_url ?? '' } })()

  return (
    <div>
      <h2 className="text-3xl font-bold text-gray-900">{f.title}</h2>
      <p className="mt-1 text-gray-500">{meta}</p>
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-2 text-sm font-semibold text-gray-600">How members will see it</p>
          <OfferPreviewCard fields={f} brandName={offer.brand_name} reasonCountry={countries[0] ?? null} reasonRole={f.roles[0] ?? null} />
          {offer.pending ? <p className="mt-2 text-sm text-gray-500">The live version stays up until you approve this change.</p> : null}
        </div>
        <div className="space-y-4">
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-[24px] bg-white p-5 text-[15px] shadow-sm">
            <dt className="text-gray-500">Where</dt>
            <dd className="text-gray-900">{countries.join(', ') || '—'}{f.area ? ` · ${f.area}` : ''} (by where members live)</dd>
            <dt className="text-gray-500">Who</dt>
            <dd className="text-gray-900">{who || '—'}</dd>
            <dt className="text-gray-500">Link</dt>
            <dd className="min-w-0">
              {f.link_url ? (
                <a href={f.link_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-hockia-primary hover:underline">
                  {host} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </a>
              ) : '—'}
            </dd>
            <dt className="text-gray-500">Dates</dt>
            <dd className="text-gray-900">{f.starts_at ? `From ${shortDate(f.starts_at)}` : 'When approved'}{f.ends_at ? `, until ${shortDate(f.ends_at)}` : ', no end date'}</dd>
            <dt className="text-gray-500">Brand</dt>
            <dd className="text-gray-900">Free plan · {offer.brand_live_count} of {OFFER_LIVE_LIMIT} live</dd>
          </dl>

          {canReview ? (
            <>
              <fieldset className="rounded-[24px] bg-white p-5 shadow-sm">
                <legend className="sr-only">Check before approving</legend>
                <p className="mb-3 font-semibold text-gray-900">Check before approving</p>
                <div className="space-y-2.5">
                  {CHECKS.map((c, i) => (
                    <label key={c} className={cn('flex cursor-pointer items-start gap-3 rounded-lg text-[15px] text-gray-700', showMissing && !checked[i] && '-mx-2 bg-status-warning-soft px-2 py-1 text-status-warning')}>
                      <input
                        type="checkbox"
                        checked={checked[i]}
                        onChange={(e) => setChecked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-hockia-primary focus-visible:ring-hockia-primary"
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Reason (required to reject; the brand sees it word for word)"
                aria-label="Reason"
                className="w-full resize-none rounded-[20px] border border-gray-200 bg-white px-4 py-3 text-[15px] focus:border-hockia-primary focus:outline-none"
              />
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setRejectOpen(true)} disabled={busy} className="h-12 rounded-full bg-hockia-soft px-6 font-semibold text-hockia-primary disabled:opacity-50" data-testid="admin-offer-reject">Reject</button>
                <button
                  type="button"
                  onClick={() => { if (!allChecked) { setShowMissing(true); return } void decide('approve', note.trim() || null) }}
                  disabled={busy}
                  className="h-12 rounded-full bg-hockia-primary px-8 font-semibold text-white disabled:opacity-40"
                  data-testid="admin-offer-approve"
                >
                  Approve
                </button>
                {showMissing && !allChecked ? <span className="text-sm font-semibold text-status-warning" role="alert">Tick the remaining checks to approve.</span> : null}
              </div>
            </>
          ) : offer.review_note ? (
            <div className="rounded-[24px] bg-white p-5 text-[15px] shadow-sm">
              <p className="font-semibold text-gray-900">Reason sent to the brand</p>
              <p className="mt-1 text-gray-700">{offer.review_note}</p>
            </div>
          ) : null}
        </div>
      </div>

      {rejectOpen ? (
        <RejectDialog
          title={f.title ?? 'this offer'}
          initial={note}
          busy={busy}
          onCancel={() => setRejectOpen(false)}
          onReject={(reason) => void decide('reject', reason)}
        />
      ) : null}
    </div>
  )
}

/** A2: reason chips fill the box; the brand sees the text word for word. */
function RejectDialog({ title, initial, busy, onCancel, onReject }: { title: string; initial: string; busy: boolean; onCancel: () => void; onReject: (reason: string) => void }) {
  const [text, setText] = useState(initial)
  const [chip, setChip] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={() => { if (!busy) onCancel() }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={`Reject "${title}"?`} className="relative w-full max-w-[520px] rounded-[28px] bg-white p-7 shadow-xl" data-testid="admin-offer-reject-dialog">
        <h2 className="text-2xl font-bold text-gray-900">Reject &ldquo;{title}&rdquo;?</h2>
        <p className="mt-2 text-gray-600">The brand sees your reason word for word and can edit the offer and send it again.</p>
        <p className="mt-4 text-sm font-semibold text-gray-600">Common reasons</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={chip === r.label}
              onClick={() => { setChip(r.label); setText(r.text) }}
              className={cn('h-9 rounded-full px-4 text-[15px]', chip === r.label ? 'border border-transparent bg-brand-soft text-brand-primary' : 'border border-gray-200 bg-white text-gray-800')}
            >
              {r.label}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={500}
          autoFocus
          aria-label="Reason the brand will see"
          className="mt-4 w-full resize-none rounded-[20px] border border-gray-200 px-4 py-3 text-[16px] focus:border-hockia-primary focus:outline-none"
        />
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="h-12 rounded-full bg-hockia-soft px-6 font-semibold text-hockia-primary">Cancel</button>
          <button type="button" onClick={() => onReject(text.trim())} disabled={busy || !text.trim()} className="h-12 rounded-full bg-status-danger px-6 font-semibold text-white disabled:opacity-40" data-testid="admin-offer-reject-confirm">
            Reject and notify brand
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminBrandOffers
