import { useEffect, useMemo, useState } from 'react'
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
import { useQuery } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { useBrandsT } from '@/i18n/ns/brands'
import { fetchMyItemNeeds, setOfferNeed, type Need } from '@/lib/marketplace'
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
  const t = useBrandsT()
  const { offerId } = useParams()
  const { user, profile } = useAuthStore()
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const { brand, isLoading: brandLoading } = useMyBrand()
  const { offers, isLoading, isFetching, refetch, save, setState, duplicate } = useMyBrandOffers(Boolean(brand))
  const addToast = useToastStore((s) => s.addToast)
  const showAi = useHockiaAiSheet((s) => s.show)
  const names = useCountryNames()

  const [menuFor, setMenuFor] = useState<BrandOffer | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [limitDraft, setLimitDraft] = useState<{ id: string | null; fields: OfferFields } | null>(null)
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null)
  // Marketplace need per offer (Figma P6): read back for the editor, saved after the offer.
  const { data: needs = new Map<string, Need>(), refetch: refetchNeeds } = useQuery({
    queryKey: ['my-brand-item-needs'],
    queryFn: fetchMyItemNeeds,
    staleTime: 60_000,
  })
  const [needDraft, setNeedDraft] = useState<Need | null>(null)
  // Desktop keeps the editor beside the list; null = nothing open.
  const [deskOpen, setDeskOpen] = useState<string | 'new' | null>(null)
  // Desktop keeps the editor in page state, so a link to /dashboard/offers/new or
  // /:id/edit (the report's Edit and Run again, a notification) opens it here too.
  useEffect(() => {
    if (isPhone) return
    if (mode === 'new') setDeskOpen('new')
    else if (mode === 'edit' && offerId) setDeskOpen(offerId)
  }, [isPhone, mode, offerId])
  // A different offer (or a new one) starts from its own saved need.
  useEffect(() => { setNeedDraft(null) }, [offerId, mode, deskOpen])

  const editing = mode === 'edit' ? offers.find((o) => o.id === offerId) ?? null : null
  const deskOffer = deskOpen && deskOpen !== 'new' ? offers.find((o) => o.id === deskOpen) ?? null : null
  // A campaign saved somewhere else (Hockia AI's draft, a notification on
  // another device) may not be in a list loaded earlier. Ask once more before
  // deciding the address leads nowhere.
  const wanted = mode === 'edit' ? offerId ?? null : !isPhone && deskOpen && deskOpen !== 'new' ? deskOpen : null
  const found = wanted ? offers.some((o) => o.id === wanted) : true
  const [askedAgain, setAskedAgain] = useState<{ id: string; done: boolean } | null>(null)
  useEffect(() => {
    if (!wanted || found || isLoading || isFetching || askedAgain?.id === wanted) return
    setAskedAgain({ id: wanted, done: false })
    const settle = () => setAskedAgain((a) => (a?.id === wanted ? { id: wanted, done: true } : a))
    void Promise.resolve(refetch()).then(settle, settle)
  }, [wanted, found, isLoading, isFetching, askedAgain, refetch])
  const stillLooking = Boolean(wanted) && !found && (isFetching || askedAgain?.id !== wanted || !askedAgain.done)
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
  const openReport = (o: BrandOffer) => navigate(`/dashboard/offers/${o.id}/report`)
  // An ended campaign cannot be edited: its row opens what it did.
  const openRow = (o: BrandOffer) => (o.status === 'ended' ? openReport(o) : openEdit(o))
  const closeEditor = () => {
    if (!isPhone) setDeskOpen(null)
    // Leave the edit or new address, on desktop too, so closing does not reopen it.
    if (isPhone || mode !== 'list') navigate('/dashboard/offers', { replace: true })
  }

  const doSave = async (id: string | null, current: BrandOffer | null, fields: OfferFields, submit: boolean) => {
    // A new go-live would pass the limit: say so before sending (B1-limit).
    const goesLiveLater = submit && current?.status !== 'live' && current?.status !== 'paused'
    if (goesLiveLater && live >= OFFER_LIVE_LIMIT) {
      setLimitDraft({ id, fields })
      return
    }
    setSaving(submit ? 'submit' : 'draft')
    try {
      const savedId = await save.mutateAsync({ id, fields, submit })
      if (needDraft && needDraft !== (id ? needs.get(id) : null)) {
        try { await setOfferNeed(savedId, needDraft); void refetchNeeds() } catch (err) { logger.error('[BrandOffers] need not saved', err) }
      }
      addToast(submit ? t('offersPage.toasts.live') : t('offersPage.toasts.draftSaved'), 'success')
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
      addToast(t('offersPage.toasts.draftSaved'), 'success')
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
      const word = { pause: t('offersPage.toasts.paused'), resume: t('offersPage.toasts.resumed'), end: t('offersPage.toasts.ended'), delete: t('offersPage.toasts.draftDeleted') }[action]
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
      addToast(t('offersPage.toasts.duplicated'), 'success')
      if (isPhone) navigate(`/dashboard/offers/${id}/edit`)
      else setDeskOpen(id)
    } catch (err) {
      addToast(offerErrorMessage(err), 'error')
    }
  }

  const brandName = brand?.name ?? t('offersPage.brandFallback')
  const loading = brandLoading || isLoading

  // ── Phone editor screens (B2) ────────────────────────────────────────────
  if (isPhone && mode !== 'list') {
    if (loading || stillLooking) return <div className="min-h-screen bg-surface-subtle" data-testid="offer-editor-loading" />
    if (mode === 'edit' && !editing) return <Navigate to="/dashboard/offers" replace />
    return (
      <>
        <OfferEditor
          key={editing?.id ?? 'new'}
          offer={editing}
          initial={editing ? offerShownFields(editing) : EMPTY_OFFER}
          brandName={brandName}
          openToPartners={Boolean(brand?.open_to_partners)}
          userId={user.id}
          saving={saving}
          onSave={(fields, submit) => void doSave(editing?.id ?? null, editing, fields, submit)}
          need={needDraft ?? (editing ? needs.get(editing.id) ?? null : null)}
          onNeedChange={setNeedDraft}
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
    <div className="space-y-6 lg:space-y-5">
      {offers.length > 0 ? (
        <p className="rounded-[20px] bg-brand-soft px-4 py-3 text-row text-brand-primary lg:hidden">
          {t('offersPage.howItWorks')}
        </p>
      ) : null}
      {GROUP_ORDER.map((g) => {
        const rows = grouped.get(g)
        if (!rows?.length) return null
        return (
          <section key={g} aria-label={OFFER_GROUP_LABELS[g]}>
            <h2 className="mb-2 px-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2 lg:px-0 lg:font-display lg:text-[12px] lg:font-bold lg:tracking-[0.12em]">{OFFER_GROUP_LABELS[g]}</h2>
            <div className="space-y-3 lg:space-y-2.5">
              {rows.map((o) => (
                <OfferRow key={o.id} offer={o} onOpen={() => openRow(o)} onMenu={() => setMenuFor(o)} selected={!isPhone && deskOpen === o.id} />
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
        <h2 className="mt-4 text-title text-ink-1">{t('offersPage.empty.title')}</h2>
        <p className="mt-2 text-row text-ink-2">
          {t('offersPage.empty.body')}
        </p>
        <Button block className="mt-5 rounded-full" onClick={openNew} data-testid="offers-create-first">{t('offersPage.empty.createFirst')}</Button>
      </div>
      <div className="rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
        <h3 className="text-body font-semibold text-ink-1">{t('offersPage.empty.tipsTitle')}</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-row text-ink-2">
          <li>{t('offersPage.empty.tipWhat')}</li>
          <li>{t('offersPage.empty.tipWhere')}</li>
          <li>{t('offersPage.empty.tipPhoto')}</li>
        </ul>
      </div>
    </div>
  )

  const body = loading ? <ListSkeleton /> : offers.length === 0 ? empty : list

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="brand-offers">
      <Header mobileHidden />
      <main className="mx-auto max-w-[1200px] px-4 pb-28 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:max-w-[1376px] lg:px-12 lg:pt-under-header-lg">
        {isPhone ? (
          <>
            <LargeTitleBar
              title={t('offersPage.title')}
              className="-mx-4 pr-2"
              trailing={
                <span className="flex items-center gap-1.5">
                  <HockiaAiButton onClick={() => showAi('header')} />
                  <button type="button" onClick={openNew} aria-label={t('offersPage.newOffer')} className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary text-white active:bg-brand-primary-pressed" data-testid="offers-new">
                    <Plus className="h-6 w-6" strokeWidth={2} />
                  </button>
                </span>
              }
            />
            {offers.length > 0 ? <p className="mb-4 mt-1 px-1 text-row text-ink-2">{liveLimitLine(offers)}</p> : <div className="h-3" />}
            {body}
          </>
        ) : (
          // Rebrand page 27 · Web · Offers list + editor: title row across the
          // page (New offer is outline: Publish owns the primary), list 520.
          <div className="pt-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-display text-[40px] font-bold leading-[1.1] tracking-[-0.035em] text-ink-1">{t('offersPage.title')}</h1>
                {offers.length > 0 ? <p className="mt-0.5 text-[15px] leading-[1.45] text-ink-2">{liveLimitLine(offers)}</p> : null}
              </div>
              <Button variant="secondary" className="shrink-0 rounded-full" icon={<Plus className="h-4 w-4" />} onClick={openNew} data-testid="offers-new">{t('offersPage.newOffer')}</Button>
            </div>
          <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-6 min-[1440px]:grid-cols-[520px_minmax(0,1fr)]">
            <div>
              {offers.length === 0 && !loading ? null : body}
            </div>
            <div>
              {deskOpen && deskOpen !== 'new' && !deskOffer && (loading || stillLooking) ? (
                // The campaign is being read: never an empty editor that would save as a new one.
                <div className="min-h-[320px] rounded-[24px] bg-white ring-1 ring-inset ring-line" data-testid="offer-editor-loading" />
              ) : deskOpen && (deskOpen === 'new' || deskOffer) ? (
                <OfferEditor
                  key={deskOpen}
                  offer={deskOffer}
                  initial={deskOffer ? offerShownFields(deskOffer) : EMPTY_OFFER}
                  brandName={brandName}
                  openToPartners={Boolean(brand?.open_to_partners)}
                  userId={user.id}
                  saving={saving}
                  onSave={(fields, submit) => void doSave(deskOffer?.id ?? null, deskOffer, fields, submit)}
                  need={needDraft ?? (deskOffer ? needs.get(deskOffer.id) ?? null : null)}
                  onNeedChange={setNeedDraft}
                  onCancel={closeEditor}
                  layout="desktop"
                />
              ) : offers.length === 0 && !loading ? (
                empty
              ) : (
                <div className="rounded-[24px] bg-white p-8 text-row text-ink-2 ring-1 ring-inset ring-line">
                  <p className="text-body font-semibold text-ink-1">{t('offersPage.deskPrompt')}</p>
                  <p className="mt-2">{t('offersPage.howItWorks')}</p>
                </div>
              )}
            </div>
          </div>
          </div>
        )}
      </main>

      <ActionsSheet
        offer={menuFor}
        countries={menuFor ? names(offerShownFields(menuFor).country_ids).join(', ') : ''}
        onClose={() => setMenuFor(null)}
        onEdit={(o) => { setMenuFor(null); openEdit(o) }}
        onReport={(o) => { setMenuFor(null); openReport(o) }}
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
  const t = useBrandsT()
  return (
    <div className="space-y-3" aria-busy="true" aria-label={t('offersPage.loading')}>
      {[0, 1, 2].map((i) => <div key={i} className="h-[124px] animate-pulse rounded-[24px] bg-white" />)}
    </div>
  )
}

interface ActionsSheetProps {
  offer: BrandOffer | null
  countries: string
  onClose: () => void
  onEdit: (o: BrandOffer) => void
  onReport: (o: BrandOffer) => void
  onDuplicate: (o: BrandOffer) => void
  onResume: (o: BrandOffer) => void
  onConfirm: (o: BrandOffer, action: 'pause' | 'end' | 'delete') => void
}

/** B3 / B3-paused: what the brand can do with one offer. */
function ActionsSheet({ offer, countries, onClose, onEdit, onReport, onDuplicate, onResume, onConfirm }: ActionsSheetProps) {
  const t = useBrandsT()
  if (!offer) return null
  const title = offerShownFields(offer).title || t('offersPage.actions.untitled')
  const statusWord = { draft: t('offers.pill.draft'), in_review: t('offers.pill.draft'), not_approved: t('offers.pill.takenDown'), live: t('offers.pill.live'), paused: t('offers.pill.paused'), ended: t('offers.pill.ended') }[offer.status]
  type Item = { key: string; label: string; hint: string; run: () => void; danger?: boolean }
  const edit: Item = {
    key: 'edit',
    label: t('offersPage.actions.edit'),
    hint: offer.status === 'live' || offer.status === 'paused' ? t('offersPage.actions.editHintLive') : offer.status === 'not_approved' ? t('offersPage.actions.editHintTakenDown') : t('offersPage.actions.editHint'),
    run: () => onEdit(offer),
  }
  const dup: Item = { key: 'dup', label: t('offersPage.actions.duplicate'), hint: t('offersPage.actions.duplicateHint'), run: () => onDuplicate(offer) }
  const end: Item = { key: 'end', label: t('offersPage.actions.end'), hint: t('offersPage.actions.endHint'), run: () => onConfirm(offer, 'end'), danger: true }
  const report: Item = { key: 'report', label: t('offersPage.actions.report'), hint: t('offersPage.actions.reportHint'), run: () => onReport(offer) }
  const base: Item[] =
    offer.status === 'live'
      ? [edit, { key: 'pause', label: t('offersPage.actions.pause'), hint: t('offersPage.actions.pauseHint'), run: () => onConfirm(offer, 'pause') }, dup, end]
      : offer.status === 'paused'
        ? [{ key: 'resume', label: t('offersPage.actions.resume'), hint: t('offersPage.actions.resumeHint'), run: () => onResume(offer) }, edit, dup, end]
        : offer.status === 'ended'
          // A campaign stops by itself; running it again starts a new draft with new dates.
          ? [{ ...dup, label: t('offersPage.actions.runAgain'), hint: t('offersPage.actions.runAgainHint') }]
          : offer.status === 'draft'
            ? [edit, dup, { key: 'delete', label: t('offersPage.actions.deleteDraft'), hint: t('offersPage.actions.deleteDraftHint'), run: () => onConfirm(offer, 'delete'), danger: true }]
            : [edit, dup, end]
  // Anything that has gone live has something to report.
  const items = offer.live_at ? [report, ...base] : base

  return (
    <BottomSheet open onClose={onClose} ariaLabel={t('offersPage.actions.aria', { title })}>
      <div className="px-5 pb-2" data-testid="offer-actions">
        <h2 className="text-title text-ink-1">{title}</h2>
        <p className="mt-1 text-row text-ink-2">{statusWord}{statusWord && countries ? ' ' : null}{countries ? <span className={statusWord ? 'ml-2 text-ink-3' : undefined}>{countries}</span> : null}</p>
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
  const t = useBrandsT()
  const [busy, setBusy] = useState(false)
  if (!confirm) return null
  const shownTitle = offerShownFields(confirm.offer).title
  const copy = {
    pause: { h: t('offersPage.confirm.pauseTitle'), p: shownTitle ? t('offersPage.confirm.pauseBody', { title: shownTitle }) : t('offersPage.confirm.pauseBodyNoTitle'), yes: t('offersPage.confirm.pauseYes'), no: t('offersPage.confirm.pauseNo'), danger: false },
    end: { h: t('offersPage.confirm.endTitle'), p: shownTitle ? t('offersPage.confirm.endBody', { title: shownTitle }) : t('offersPage.confirm.endBodyNoTitle'), yes: t('offersPage.confirm.endYes'), no: t('offersPage.confirm.endNo'), danger: true },
    delete: { h: t('offersPage.confirm.deleteTitle'), p: shownTitle ? t('offersPage.confirm.deleteBody', { title: shownTitle }) : t('offersPage.confirm.deleteBodyNoTitle'), yes: t('offersPage.confirm.deleteYes'), no: t('offersPage.confirm.deleteNo'), danger: true },
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
  const t = useBrandsT()
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('offersPage.limit.title', { limit: OFFER_LIVE_LIMIT })}>
      <div className="px-5 pb-2" data-testid="offers-limit">
        <h2 className="text-title text-ink-1">{t('offersPage.limit.title', { limit: OFFER_LIVE_LIMIT })}</h2>
        <p className="mt-2 text-body text-ink-2">
          {t('offersPage.limit.body', { limit: OFFER_LIVE_LIMIT })}
        </p>
        <Button block className="mt-5 rounded-full" onClick={onChoose}>{t('offersPage.limit.choose')}</Button>
        <Button block variant="tonal" className="mt-3 rounded-full" onClick={onDraft}>{t('offersPage.limit.saveDraft')}</Button>
      </div>
    </BottomSheet>
  )
}
