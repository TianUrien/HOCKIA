import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import Header from '@/components/Header'
import { useAuthStore } from '@/lib/auth'
import { useMyBrand } from '@/hooks/useMyBrand'
import { useMyBrandOffers } from '@/hooks/useBrandOffers'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useToastStore } from '@/lib/toast'
import { LargeTitleBar } from '@/components/ui/LargeTitleBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { HockiaAiButton } from '@/components/hockiaAi/HockiaAiButton'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'
import { OfferRow } from '@/components/brands/offers/OfferParts'
import { useCountryNames } from '@/hooks/useCountryNames'
import { OfferEditor } from '@/components/brands/offers/OfferEditor'
import {
  EMPTY_OFFER,
  OFFER_GROUP_LABELS,
  OFFER_LIVE_LIMIT,
  liveCount,
  liveLimitLine,
  offerErrorMessage,
  offerGroup,
  offerShownFields,
  type BrandOffer,
  type OfferFields,
  type OfferGroup,
} from '@/lib/brandOffers'

const GROUP_ORDER: OfferGroup[] = ['needs_you', 'live', 'waiting', 'paused_ended']

type Confirm = { offer: BrandOffer; action: 'pause' | 'end' | 'delete' } | null

/**
 * Brand Offers, Phase 1 (Figma "08 · Brands", P1: B1 list and states, B2
 * editor, B3 actions, B4 confirmations, D1 desktop). Routes:
 * /dashboard/offers, /dashboard/offers/new, /dashboard/offers/:offerId/edit.
 * Phones push the editor as its own screen; desktop shows it beside the list.
 */
export default function BrandOffersPage({ mode = 'list' }: { mode?: 'list' | 'new' | 'edit' }) {
  const navigate = useNavigate()
  const { offerId } = useParams()
  const { user, profile } = useAuthStore()
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const { brand, isLoading: brandLoading } = useMyBrand()
  const { offers, isLoading, save, setState, duplicate } = useMyBrandOffers(Boolean(brand))
  const addToast = useToastStore((s) => s.addToast)
  const showAi = useHockiaAiSheet((s) => s.show)
  const names = useCountryNames()

  const [menuFor, setMenuFor] = useState<BrandOffer | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [limitDraft, setLimitDraft] = useState<{ id: string | null; fields: OfferFields } | null>(null)
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null)
  // Desktop keeps the editor beside the list; null = nothing open.
  const [deskOpen, setDeskOpen] = useState<string | 'new' | null>(null)

  const editing = mode === 'edit' ? offers.find((o) => o.id === offerId) ?? null : null
  const deskOffer = deskOpen && deskOpen !== 'new' ? offers.find((o) => o.id === deskOpen) ?? null : null
  const live = liveCount(offers)

  const grouped = useMemo(() => {
    const map = new Map<OfferGroup, BrandOffer[]>()
    for (const o of offers) {
      const g = offerGroup(o)
      map.set(g, [...(map.get(g) ?? []), o])
    }
    return map
  }, [offers])

  if (!user) return <Navigate to="/signup" replace />
  if (profile && profile.role !== 'brand') return <Navigate to="/dashboard/profile" replace />
  if (!brandLoading && !brand) return <Navigate to="/brands/onboarding" replace />

  const openNew = () => (isPhone ? navigate('/dashboard/offers/new') : setDeskOpen('new'))
  const openEdit = (o: BrandOffer) => (isPhone ? navigate(`/dashboard/offers/${o.id}/edit`) : setDeskOpen(o.id))
  const closeEditor = () => (isPhone ? navigate('/dashboard/offers', { replace: true }) : setDeskOpen(null))

  const doSave = async (id: string | null, current: BrandOffer | null, fields: OfferFields, submit: boolean) => {
    // A new go-live would pass the limit: say so before sending (B1-limit).
    const goesLiveLater = submit && current?.status !== 'live' && current?.status !== 'paused'
    if (goesLiveLater && live >= OFFER_LIVE_LIMIT) {
      setLimitDraft({ id, fields })
      return
    }
    setSaving(submit ? 'submit' : 'draft')
    try {
      await save.mutateAsync({ id, fields, submit })
      addToast(submit ? 'Sent for review. We’ll tell you when it’s checked.' : 'Draft saved', 'success')
      closeEditor()
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
    } finally {
      setSaving(null)
    }
  }

  const saveLimitDraft = async () => {
    if (!limitDraft) return
    const draft = limitDraft
    setLimitDraft(null)
    setSaving('draft')
    try {
      await save.mutateAsync({ id: draft.id, fields: draft.fields, submit: false })
      addToast('Draft saved', 'success')
      closeEditor()
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
    } finally {
      setSaving(null)
    }
  }

  const runState = async (o: BrandOffer, action: 'pause' | 'resume' | 'end' | 'delete') => {
    if (action === 'resume' && live >= OFFER_LIVE_LIMIT) {
      setLimitDraft(null)
      addToast(offerErrorMessage({ message: 'live_limit' }), 'error')
      return
    }
    try {
      await setState.mutateAsync({ id: o.id, action })
      const word = { pause: 'Offer paused', resume: 'Offer is live again', end: 'Offer ended', delete: 'Draft deleted' }[action]
      addToast(word, 'success')
      if (deskOpen === o.id && (action === 'end' || action === 'delete')) setDeskOpen(null)
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
      throw err
    }
  }

  const runDuplicate = async (o: BrandOffer) => {
    try {
      const id = await duplicate.mutateAsync(o.id)
      addToast('Copied as a new draft', 'success')
      if (isPhone) navigate(`/dashboard/offers/${id}/edit`)
      else setDeskOpen(id)
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
    }
  }

  const brandName = brand?.name ?? 'Your brand'
  const loading = brandLoading || isLoading

  // ── Phone editor screens (B2) ────────────────────────────────────────────
  if (isPhone && mode !== 'list') {
    if (loading) return <div className="min-h-screen bg-surface-subtle" />
    if (mode === 'edit' && !editing) return <Navigate to="/dashboard/offers" replace />
    return (
      <>
        <OfferEditor
          key={editing?.id ?? 'new'}
          offer={editing}
          initial={editing ? offerShownFields(editing) : EMPTY_OFFER}
          brandName={brandName}
          userId={user.id}
          saving={saving}
          onSave={(fields, submit) => void doSave(editing?.id ?? null, editing, fields, submit)}
          onCancel={closeEditor}
          layout="phone"
        />
        <LimitSheet
          open={limitDraft !== null}
          onClose={() => setLimitDraft(null)}
          onChoose={() => { setLimitDraft(null); closeEditor() }}
          onDraft={() => void saveLimitDraft()}
        />
      </>
    )
  }

  const list = (
    <div className="space-y-6">
      {offers.length > 0 ? (
        <p className="rounded-[20px] bg-brand-soft px-4 py-3 text-row text-brand-primary lg:hidden">
          An admin reviews every offer before it goes live. Offers reach members by where they live, never by nationality.
        </p>
      ) : null}
      {GROUP_ORDER.map((g) => {
        const rows = grouped.get(g)
        if (!rows?.length) return null
        return (
          <section key={g} aria-label={OFFER_GROUP_LABELS[g]}>
            <h2 className="mb-2 px-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2 lg:hidden">{OFFER_GROUP_LABELS[g]}</h2>
            <div className="space-y-3">
              {rows.map((o) => (
                <OfferRow key={o.id} offer={o} onOpen={() => openEdit(o)} onMenu={() => setMenuFor(o)} selected={!isPhone && deskOpen === o.id} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )

  const empty = (
    <div className="space-y-4" data-testid="offers-empty">
      <div className="rounded-[24px] bg-white px-6 pb-6 pt-7 text-center shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
        <span className="mx-auto block h-[72px] w-[72px] rounded-[20px] bg-gradient-to-br from-brand-primary to-brand-primary-pressed" aria-hidden="true" />
        <h2 className="mt-4 text-title text-ink-1">Bring something useful to members</h2>
        <p className="mt-2 text-row text-ink-2">
          An offer is a product or service for hockey members where they live: a discount, a fitting, a camp place. It&rsquo;s free, and an admin checks it before it goes live.
        </p>
        <Button block className="mt-5 rounded-full" onClick={openNew} data-testid="offers-create-first">Create your first offer</Button>
      </div>
      <div className="rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
        <h3 className="text-body font-semibold text-ink-1">What works with members</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-row text-ink-2">
          <li>Say exactly what a member gets.</li>
          <li>Pick the countries where your customers live.</li>
          <li>Use a real photo of the product or service.</li>
        </ul>
      </div>
    </div>
  )

  const body = loading ? <ListSkeleton /> : offers.length === 0 ? empty : list

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="brand-offers">
      <Header mobileHidden />
      <main className="mx-auto max-w-[1200px] px-4 pb-28 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:px-6 lg:pt-under-header-lg">
        {isPhone ? (
          <>
            <LargeTitleBar
              title="Offers"
              className="-mx-4 pr-3"
              trailing={
                <span className="flex items-center gap-2">
                  <HockiaAiButton onClick={() => showAi('header')} />
                  <button type="button" onClick={openNew} aria-label="New offer" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary text-white active:bg-brand-primary-pressed" data-testid="offers-new">
                    <Plus className="h-6 w-6" strokeWidth={2} />
                  </button>
                </span>
              }
            />
            {offers.length > 0 ? <p className="mb-4 mt-1 px-1 text-row text-ink-2">{liveLimitLine(offers)}</p> : <div className="h-3" />}
            {body}
          </>
        ) : (
          <div className="grid grid-cols-[380px_minmax(0,1fr)] gap-8 pt-6">
            <div>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-title-xl text-ink-1">Offers</h1>
                  <p className="mt-1 text-row text-ink-2">{liveLimitLine(offers)}</p>
                </div>
                <Button size="small" className="rounded-full" icon={<Plus className="h-4 w-4" />} onClick={openNew} data-testid="offers-new">New offer</Button>
              </div>
              {offers.length === 0 && !loading ? null : body}
            </div>
            <div>
              {deskOpen ? (
                <OfferEditor
                  key={deskOpen}
                  offer={deskOffer}
                  initial={deskOffer ? offerShownFields(deskOffer) : EMPTY_OFFER}
                  brandName={brandName}
                  userId={user.id}
                  saving={saving}
                  onSave={(fields, submit) => void doSave(deskOffer?.id ?? null, deskOffer, fields, submit)}
                  onCancel={closeEditor}
                  layout="desktop"
                />
              ) : offers.length === 0 && !loading ? (
                empty
              ) : (
                <div className="rounded-[24px] bg-white p-8 text-row text-ink-2 shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
                  <p className="text-body font-semibold text-ink-1">Choose an offer to edit, or create a new one.</p>
                  <p className="mt-2">An admin reviews every offer before it goes live. Offers reach members by where they live, never by nationality.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <ActionsSheet
        offer={menuFor}
        countries={menuFor ? names(offerShownFields(menuFor).country_ids).join(', ') : ''}
        onClose={() => setMenuFor(null)}
        onEdit={(o) => { setMenuFor(null); openEdit(o) }}
        onDuplicate={(o) => { setMenuFor(null); void runDuplicate(o) }}
        onResume={(o) => { setMenuFor(null); void runState(o, 'resume').catch(() => undefined) }}
        onConfirm={(o, action) => { setMenuFor(null); setConfirm({ offer: o, action }) }}
      />

      <OfferConfirmSheet confirm={confirm} onClose={() => setConfirm(null)} onConfirm={(c) => runState(c.offer, c.action)} />

      <LimitSheet
        open={limitDraft !== null}
        onClose={() => setLimitDraft(null)}
        onChoose={() => { setLimitDraft(null); setDeskOpen(null) }}
        onDraft={() => void saveLimitDraft()}
      />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading offers">
      {[0, 1, 2].map((i) => <div key={i} className="h-[124px] animate-pulse rounded-[24px] bg-white" />)}
    </div>
  )
}

interface ActionsSheetProps {
  offer: BrandOffer | null
  countries: string
  onClose: () => void
  onEdit: (o: BrandOffer) => void
  onDuplicate: (o: BrandOffer) => void
  onResume: (o: BrandOffer) => void
  onConfirm: (o: BrandOffer, action: 'pause' | 'end' | 'delete') => void
}

/** B3 / B3-paused: what the brand can do with one offer. */
function ActionsSheet({ offer, countries, onClose, onEdit, onDuplicate, onResume, onConfirm }: ActionsSheetProps) {
  if (!offer) return null
  const title = offerShownFields(offer).title || 'Untitled offer'
  const statusWord = { draft: 'Draft', in_review: 'In review', not_approved: 'Not approved', live: 'Live', paused: 'Paused', ended: 'Ended' }[offer.status]
  type Item = { key: string; label: string; hint: string; run: () => void; danger?: boolean }
  const edit: Item = {
    key: 'edit',
    label: 'Edit',
    hint: offer.status === 'live' || offer.status === 'paused' ? 'Changes go to review before members see them.' : offer.status === 'in_review' ? 'You can still change it while it waits.' : 'Change the photo, text or audience.',
    run: () => onEdit(offer),
  }
  const dup: Item = { key: 'dup', label: 'Duplicate', hint: 'A new draft with the same photo, text and audience.', run: () => onDuplicate(offer) }
  const end: Item = { key: 'end', label: 'End offer', hint: 'It stops for good and moves to Ended.', run: () => onConfirm(offer, 'end'), danger: true }
  const items: Item[] =
    offer.status === 'live'
      ? [edit, { key: 'pause', label: 'Pause', hint: 'Members stop seeing it. Your results are kept.', run: () => onConfirm(offer, 'pause') }, dup, end]
      : offer.status === 'paused'
        ? [{ key: 'resume', label: 'Resume', hint: 'Members see it again right away. No new review unless you edit it.', run: () => onResume(offer) }, edit, dup, end]
        : offer.status === 'ended'
          ? [dup]
          : offer.status === 'draft'
            ? [edit, dup, { key: 'delete', label: 'Delete draft', hint: 'It is removed. Nobody has seen it.', run: () => onConfirm(offer, 'delete'), danger: true }]
            : [edit, dup, end]

  return (
    <BottomSheet open onClose={onClose} ariaLabel={`Actions for ${title}`}>
      <div className="px-5 pb-2" data-testid="offer-actions">
        <h2 className="text-title text-ink-1">{title}</h2>
        <p className="mt-1 text-row text-ink-2">{[statusWord, countries].filter(Boolean).join(' · ')}</p>
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {items.map((it) => (
            <li key={it.key}>
              <button type="button" onClick={it.run} className="block w-full py-3.5 text-left" data-testid={`offer-action-${it.key}`}>
                <span className={`block text-body font-semibold ${it.danger ? 'text-status-danger' : 'text-ink-1'}`}>{it.label}</span>
                <span className="mt-0.5 block text-row text-ink-2">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </BottomSheet>
  )
}

/** B4-pause / B4-end (and deleting a draft): left-aligned sheet, solid confirm + tonal cancel. */
function OfferConfirmSheet({ confirm, onClose, onConfirm }: { confirm: Confirm; onClose: () => void; onConfirm: (c: NonNullable<Confirm>) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  if (!confirm) return null
  const title = offerShownFields(confirm.offer).title || 'this offer'
  const copy = {
    pause: { h: 'Pause this offer?', p: `Members stop seeing "${title}". Your results are kept, and you can resume it any time.`, yes: 'Pause offer', no: 'Cancel', danger: false },
    end: { h: 'End this offer?', p: `"${title}" stops for good and moves to Ended. Your results are kept. To run it again, duplicate it.`, yes: 'End offer', no: 'Keep it live', danger: true },
    delete: { h: 'Delete this draft?', p: `"${title}" is removed. Nobody has seen it.`, yes: 'Delete draft', no: 'Keep it', danger: true },
  }[confirm.action]
  const run = async () => {
    setBusy(true)
    try {
      await onConfirm(confirm)
      onClose()
    } catch {
      /* toasted by the caller; the sheet stays open */
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet open onClose={() => { if (!busy) onClose() }} ariaLabel={copy.h}>
      <div className="px-5 pb-2" data-testid={`offer-confirm-${confirm.action}`}>
        <h2 className="text-title text-ink-1">{copy.h}</h2>
        <p className="mt-2 text-body text-ink-2">{copy.p}</p>
        <Button block variant={copy.danger ? 'danger' : 'primary'} className="mt-5 rounded-full" loading={busy} onClick={() => void run()} data-testid="offer-confirm-yes">{copy.yes}</Button>
        <Button block variant="tonal" className="mt-3 rounded-full" disabled={busy} onClick={onClose}>{copy.no}</Button>
      </div>
    </BottomSheet>
  )
}

/** B1-limit: a 6th live offer would pass the free limit. */
function LimitSheet({ open, onClose, onChoose, onDraft }: { open: boolean; onClose: () => void; onChoose: () => void; onDraft: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={`You have ${OFFER_LIVE_LIMIT} live offers`}>
      <div className="px-5 pb-2" data-testid="offers-limit">
        <h2 className="text-title text-ink-1">You have {OFFER_LIVE_LIMIT} live offers</h2>
        <p className="mt-2 text-body text-ink-2">
          While HOCKIA is free, each brand can have up to {OFFER_LIVE_LIMIT} live offers. Pause or end one to make room. Drafts don&rsquo;t count.
        </p>
        <Button block className="mt-5 rounded-full" onClick={onChoose}>Choose an offer to pause</Button>
        <Button block variant="tonal" className="mt-3 rounded-full" onClick={onDraft}>Save as a draft instead</Button>
      </div>
    </BottomSheet>
  )
}
