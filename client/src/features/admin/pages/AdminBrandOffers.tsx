/**
 * AdminBrandOffers Page
 *
 * Brand offers moderation (founder 2026-10-25: no approval step). Offers go
 * live as soon as a brand publishes them; here an admin sees what is live and
 * can take an offer down with a reason the brand sees word for word (it lands
 * under "Needs you" for the brand, who can edit and publish again).
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
  { value: 'live', label: 'Live' },
  { value: 'not_approved', label: 'Taken down' },
]

/** Common reasons: each fills the reason box with a sentence the brand can act on. */
const REASONS: { label: string; text: string }[] = [
  { label: 'A claim we can’t check', text: 'Please remove claims we can’t check, like "best" or "cheapest". Say exactly what members get, then publish again.' },
  { label: 'Link doesn’t open', text: 'The link doesn’t open or doesn’t match the offer. Please fix it and publish again.' },
  { label: 'Targets nationality', text: 'Offers can reach members only by where they live, never by nationality. Please change the audience and publish again.' },
  { label: 'Not allowed category', text: 'This category isn’t allowed on HOCKIA (for example betting, alcohol or tobacco).' },
  { label: 'Aimed at under-18s', text: 'Offers on HOCKIA are for adults only. Please change the offer so it isn’t aimed at under-18s.' },
  { label: 'Photo with text', text: 'Please use a real photo of the product or service, without text on the image, then publish again.' },
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
  const [tab, setTab] = useState<AdminOfferTab>('live')
  const counts = useAdminBrandOfferCounts()
  const { offers, isLoading, takeDown } = useAdminBrandOffers(tab)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = offers.find((o) => o.id === selectedId) ?? offers[0] ?? null

  useEffect(() => { setSelectedId(null) }, [tab])

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(320px,580px)_minmax(0,1fr)]" data-testid="admin-brand-offers">
      {/* The list stays in view while the detail scrolls, so the next offer is one click away. */}
      <div className="xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:self-start xl:overflow-y-auto xl:pb-4">
        <h1 className="text-3xl font-bold text-gray-900">Brand offers</h1>
        <p className="mt-2 text-gray-500">Offers go live as soon as a brand publishes them. Take one down if it breaks the rules.</p>
        <div className="mt-5 inline-flex rounded-full bg-gray-100 p-1" role="tablist" aria-label="Offers">
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
            <EmptyList tab={tab} />
          ) : (
            offers.map((o) => (
              <QueueRow key={o.id} offer={o} active={selected?.id === o.id} onClick={() => setSelectedId(o.id)} />
            ))
          )}
        </div>
      </div>

      {selected ? (
        <OfferPanel
          key={selected.id}
          offer={selected}
          canTakeDown={tab === 'live'}
          busy={takeDown.isPending}
          onTakeDown={(reason) => takeDown.mutateAsync({ id: selected.id, reason })}
        />
      ) : null}
    </div>
  )
}

function EmptyList({ tab }: { tab: AdminOfferTab }) {
  const copy = {
    live: { h: 'No live offers', p: 'Offers appear here as soon as a brand publishes them.' },
    not_approved: { h: 'Nothing taken down', p: 'Offers you take down stay here until the brand publishes them again.' },
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
        <span className="block text-sm text-gray-500">{offer.brand_name}</span>
        <span className="block truncate text-lg font-semibold text-gray-900">{f.title}</span>
        <span className="block truncate text-sm text-gray-500">{audienceLine(names(f.country_ids), f.roles)}</span>
      </span>
      <span className="self-start text-sm text-gray-500">{ago(offer.live_at ?? offer.submitted_at)}</span>
    </button>
  )
}

interface OfferPanelProps {
  offer: AdminBrandOffer
  canTakeDown: boolean
  busy: boolean
  onTakeDown: (reason: string) => Promise<unknown>
}

function OfferPanel({ offer, canTakeDown, busy, onTakeDown }: OfferPanelProps) {
  const names = useCountryNames()
  const addToast = useToastStore((s) => s.addToast)
  const f = shownFields(offer)
  const [dialogOpen, setDialogOpen] = useState(false)
  const countries = names(f.country_ids)
  const where = [countries.join(', '), f.area?.trim()].filter(Boolean).join(' · ')
  const who = f.roles.map((r) => OFFER_ROLES.find((x) => x.value === r)?.label ?? r).join(', ')

  const meta = useMemo(() => {
    const parts = [offer.brand_name]
    if (offer.live_at) parts.push(`live since ${shortDate(offer.live_at)}`)
    if (offer.brand_offer_count <= 1) parts.push('first offer from this brand')
    return parts.join(' · ')
  }, [offer])

  const takeDown = async (reason: string) => {
    try {
      await onTakeDown(reason)
      addToast('Taken down. The brand sees your reason.', 'success')
      setDialogOpen(false)
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
          <p className="mb-2 text-sm font-semibold text-gray-600">How members see it</p>
          <OfferPreviewCard fields={f} brandName={offer.brand_name} reasonCountry={countries[0] ?? null} reasonRole={f.roles[0] ?? null} />
        </div>
        <div className="space-y-4">
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-[24px] bg-white p-5 text-[15px] shadow-sm">
            {where ? (<><dt className="text-gray-500">Where</dt><dd className="text-gray-900">{where} (by where members live)</dd></>) : null}
            {who ? (<><dt className="text-gray-500">Who</dt><dd className="text-gray-900">{who}</dd></>) : null}
            {f.link_url ? (
              <>
                <dt className="text-gray-500">Link</dt>
                <dd className="min-w-0">
                  <a href={f.link_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-hockia-primary hover:underline">
                    {host} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </dd>
              </>
            ) : null}
            <dt className="text-gray-500">Dates</dt>
            <dd className="text-gray-900">{f.starts_at ? `From ${shortDate(f.starts_at)}` : 'From publishing'}{f.ends_at ? `, until ${shortDate(f.ends_at)}` : ', no end date'}</dd>
            <dt className="text-gray-500">Brand</dt>
            <dd className="text-gray-900">Free plan · {offer.brand_live_count} of {OFFER_LIVE_LIMIT} live</dd>
          </dl>

          {canTakeDown ? (
            <button type="button" onClick={() => setDialogOpen(true)} disabled={busy} className="h-12 rounded-full bg-status-danger-soft px-6 font-semibold text-status-danger disabled:opacity-50" data-testid="admin-offer-take-down">
              Take down
            </button>
          ) : offer.review_note ? (
            <div className="rounded-[24px] bg-white p-5 text-[15px] shadow-sm">
              <p className="font-semibold text-gray-900">Reason sent to the brand</p>
              <p className="mt-1 text-gray-700">{offer.review_note}</p>
            </div>
          ) : null}
        </div>
      </div>

      {dialogOpen ? (
        <TakeDownDialog title={f.title ?? 'this offer'} busy={busy} onCancel={() => setDialogOpen(false)} onConfirm={(reason) => void takeDown(reason)} />
      ) : null}
    </div>
  )
}

/** Reason chips fill the box; the brand sees the text word for word. */
function TakeDownDialog({ title, busy, onCancel, onConfirm }: { title: string; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [text, setText] = useState('')
  const [chip, setChip] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={() => { if (!busy) onCancel() }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={`Take down "${title}"?`} className="relative w-full max-w-[520px] rounded-[28px] bg-white p-7 shadow-xl" data-testid="admin-offer-take-down-dialog">
        <h2 className="text-2xl font-bold text-gray-900">Take down &ldquo;{title}&rdquo;?</h2>
        <p className="mt-2 text-gray-600">Members stop seeing it now. The brand sees your reason word for word and can edit the offer and publish again.</p>
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
          placeholder="Reason the brand will see"
          aria-label="Reason the brand will see"
          className="mt-4 w-full resize-none rounded-[20px] border border-gray-200 px-4 py-3 text-[16px] focus:border-hockia-primary focus:outline-none"
        />
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="h-12 rounded-full bg-hockia-soft px-6 font-semibold text-hockia-primary">Cancel</button>
          <button type="button" onClick={() => onConfirm(text.trim())} disabled={busy || !text.trim()} className="h-12 rounded-full bg-status-danger px-6 font-semibold text-white disabled:opacity-40" data-testid="admin-offer-take-down-confirm">
            Take down and tell the brand
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminBrandOffers
