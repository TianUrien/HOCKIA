import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { searchCountries } from '@/lib/countrySearch'
import { useCountries } from '@/hooks/useCountries'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { chipTone } from '@/components/ui/chipClasses'
import { fieldInput, fieldLabel, fieldLabelRow, fieldOptionalTag } from '@/components/ui/fieldClasses'
import {
  CAMPAIGN_DEFAULT_DAYS,
  CAMPAIGN_MAX_DAYS,
  CAMPAIGN_MIN_DAYS,
  OFFER_BODY_MAX,
  OFFER_OBJECTIVES,
  OFFER_PERK_MAX,
  OFFER_REGIONS,
  OFFER_ROLES,
  OFFER_TITLE_MAX,
  campaignEnd,
  campaignStart,
  fetchOfferReach,
  linkOptional,
  offerMissing,
  reachLine,
  unprovableClaim,
  type BrandOffer,
  type OfferFields,
  type OfferObjective,
  type OfferRole,
} from '@/lib/brandOffers'
import { OfferPreviewCard, OfferThumb, OfferPill } from './OfferParts'
import { useCountryNames } from '@/hooks/useCountryNames'
import { NeedPicker } from '@/components/marketplace/NeedPicker'
import type { Need } from '@/lib/marketplace'
import { offerRegionLabel } from '@/lib/memberOffers'
import { useBrandsT } from '@/i18n/ns/brands'
import { countryLabel } from '@/i18n/countryNames'

const BUCKET = 'brand-products'
const MAX_COUNTRIES = 30

interface OfferEditorProps {
  /** The offer being edited; null for a new one. */
  offer: BrandOffer | null
  initial: OfferFields
  brandName: string
  /** The brand takes ambassador applications ("Open to partners"). */
  openToPartners?: boolean
  userId: string
  saving: 'draft' | 'submit' | null
  onSave: (fields: OfferFields, submit: boolean) => void
  /** The Marketplace need (Figma P6); saved after the offer by the page. */
  need: Need | null
  onNeedChange: (need: Need) => void
  onCancel: () => void
  layout: 'phone' | 'desktop'
}

/**
 * Create / edit a campaign (Figma B2 phone, D1 desktop panel). The brand first
 * says what it wants members to do (founder 2026-11-21); that objective sets
 * the fields below and the member's button. Publish makes it live at once
 * (founder 2026-10-25: no approval step); edits to a live or paused campaign
 * apply at once. Anything not live can also be saved as a draft. A campaign
 * runs 7 to 15 days and stops by itself.
 */
export function OfferEditor({ offer, initial, brandName, openToPartners = false, userId, saving, onSave, onCancel, layout, need, onNeedChange }: OfferEditorProps) {
  const t = useBrandsT()
  const [f, setF] = useState<OfferFields>(initial)
  const [tried, setTried] = useState(false)
  const topBar = useRef<HTMLDivElement>(null)
  const bottomBar = useRef<HTMLDivElement>(null)
  const set = <K extends keyof OfferFields>(key: K, value: OfferFields[K]) => setF((prev) => ({ ...prev, [key]: value }))
  const names = useCountryNames()
  const countryNames = names(f.country_ids)

  const isChange = offer?.status === 'live' || offer?.status === 'paused'
  const objective = f.objective ?? null
  const needsOpen = objective === 'ambassador' && !openToPartners
  // Same rule as the server: only a running campaign that already has an end
  // date keeps its window; anything going live starts a new one today.
  const anchor = isChange && offer?.ends_at ? offer.starts_at ?? offer.live_at : null
  const starts = anchor ? f.starts_at ?? anchor : f.starts_at && new Date(f.starts_at).getTime() > Date.now() ? f.starts_at : null
  const missing = needsOpen ? t('offerEditor.ambassadorNeedsOpen') : offerMissing({ ...f, starts_at: starts }, anchor)
  const start = campaignStart({ starts_at: starts }, anchor)
  const pickObjective = (o: OfferObjective) => setF((prev) => ({
    ...prev,
    objective: o,
    // Only players can be ambassadors.
    roles: o === 'ambassador' ? ['player'] : prev.roles,
    // The window starts at 14 days; the brand can change it within 7 to 15.
    ends_at: prev.ends_at ?? campaignEnd(start),
  }))
  const objKey = objective ?? 'offer'
  const claim = unprovableClaim(`${f.title ?? ''} ${f.body ?? ''}`)
  const busy = saving !== null
  const title = offer ? t('offerEditor.titleEdit') : t('offerEditor.titleNew')

  const submit = () => {
    setTried(true)
    if (missing) return
    onSave(f, true)
  }

  const preview = (
    <OfferPreviewCard fields={f} brandName={brandName} reasonCountry={countryNames[0] ?? null} reasonRole={f.roles[0] ?? null} />
  )

  const actions = (
    <div className="space-y-2">
      {tried && missing ? <p className="text-secondary text-status-danger" role="alert">{missing}</p> : null}
      <Button block onClick={submit} loading={saving === 'submit'} disabled={busy} data-testid="offer-send">
        {isChange ? t('offerEditor.publishChanges') : t('offerEditor.publish')}
      </Button>
      {layout === 'desktop' && !isChange ? (
        <Button block variant="tonal" onClick={() => onSave(f, false)} loading={saving === 'draft'} disabled={busy}>{t('offerEditor.saveDraft')}</Button>
      ) : null}
      <p className="text-secondary text-ink-2">
        {isChange ? t('offerEditor.noteChangesPhone') : t('offerEditor.noteNew')}
      </p>
    </div>
  )

  const form = (
    <div className="space-y-6">
      <fieldset data-testid="offer-objective">
        <legend className={fieldLabel}>{t('offerEditor.objectiveLabel')}</legend>
        <div className="space-y-2">
          {OFFER_OBJECTIVES.map((o) => {
            const on = objective === o.value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickObjective(o.value)}
                className={cn('block w-full rounded-[16px] bg-white px-4 py-3 text-left ring-1 ring-inset', on ? 'bg-brand-soft ring-[1.5px] ring-brand-primary' : 'ring-line')}
                data-testid={`offer-objective-${o.value}`}
              >
                <span className={cn('block text-body font-semibold', on ? 'text-brand-primary' : 'text-ink-1')}>{o.label}</span>
                <span className="mt-0.5 block text-row text-ink-2">{o.hint}</span>
              </button>
            )
          })}
        </div>
        {objective ? null : <p className="mt-1.5 text-caption text-ink-3">{t('offerEditor.objectiveHint')}</p>}
      </fieldset>

      {objective ? (<>
      <PhotoField url={f.image_url} userId={userId} onChange={(url) => set('image_url', url)} />

      <div>
        <div className={fieldLabelRow}><label htmlFor="offer-title">{t('offerEditor.titleLabel')}</label></div>
        <div className="relative">
          <input
            id="offer-title"
            value={f.title ?? ''}
            maxLength={OFFER_TITLE_MAX}
            onChange={(e) => set('title', e.target.value)}
            placeholder={t(`offerEditor.titlePlaceholders.${objKey}`)}
            className={cn(fieldInput, 'pr-16')}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-caption text-ink-3">{(f.title ?? '').length}/{OFFER_TITLE_MAX}</span>
        </div>
      </div>

      <NeedPicker value={need} onChange={onNeedChange} idPrefix="offer-need" />

      <div>
        <div className={fieldLabelRow}><label htmlFor="offer-body">{objective === 'ask' ? t('offerEditor.bodyLabelAsk') : t('offerEditor.bodyLabel')}</label></div>
        <div className="relative">
          <textarea
            id="offer-body"
            value={f.body ?? ''}
            maxLength={OFFER_BODY_MAX}
            rows={3}
            onChange={(e) => set('body', e.target.value)}
            placeholder={t(`offerEditor.bodyPlaceholders.${objKey}`)}
            className={cn(fieldInput, 'h-auto resize-none py-3 pr-16')}
          />
          <span className="pointer-events-none absolute right-3.5 top-3 text-caption text-ink-3">{(f.body ?? '').length}/{OFFER_BODY_MAX}</span>
        </div>
        <p className={cn('mt-1.5 text-caption', claim ? 'text-status-warning' : 'text-ink-3')}>
          {claim
            ? t('offerEditor.claimWarning', { claim })
            : t('offerEditor.bodyHint')}
        </p>
      </div>

      {objective === 'offer' ? (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className={fieldLabelRow}><label htmlFor="offer-perk">{t('offerEditor.perkLabel')}</label><span className={fieldOptionalTag}>{t('offerEditor.optional')}</span></div>
          <input id="offer-perk" value={f.perk ?? ''} maxLength={OFFER_PERK_MAX} onChange={(e) => set('perk', e.target.value)} placeholder={t('offerEditor.perkPlaceholder')} className={fieldInput} data-testid="offer-perk-input" />
          <p className="mt-1.5 text-caption text-ink-3">{t('offerEditor.perkHint')}</p>
        </div>
        <div>
          <div className={fieldLabelRow}><label htmlFor="offer-code">{t('offerEditor.codeLabel')}</label><span className={fieldOptionalTag}>{t('offerEditor.optional')}</span></div>
          <input id="offer-code" value={f.promo_code ?? ''} maxLength={30} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(e) => set('promo_code', e.target.value.replace(/\s+/g, '').toUpperCase())} placeholder="HOCKIA15" className={fieldInput} data-testid="offer-code-input" />
          <p className="mt-1.5 text-caption text-ink-3">{t('offerEditor.codeHint')}</p>
        </div>
      </div>
      ) : null}

      <div>
        <div className={fieldLabelRow}><label htmlFor="offer-link">{t('offerEditor.linkLabel')}</label>{linkOptional(objective) ? <span className={fieldOptionalTag}>{t('offerEditor.optional')}</span> : null}</div>
        <input
          id="offer-link"
          value={f.link_url ?? ''}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => set('link_url', e.target.value)}
          placeholder={t('offerEditor.linkPlaceholder')}
          className={fieldInput}
        />
        <p className="mt-1.5 text-caption text-ink-3">{linkOptional(objective) ? t('offerEditor.linkHintOptional') : t('offerEditor.linkHint')}</p>
      </div>

      <PlaceField
        everywhere={f.everywhere ?? false}
        regions={f.regions ?? []}
        countryIds={f.country_ids}
        names={countryNames}
        onEverywhere={(on) => setF((prev) => ({ ...prev, everywhere: on, ...(on ? { regions: [], country_ids: [], area: '' } : {}) }))}
        onRegions={(r) => set('regions', r)}
        onCountries={(ids) => set('country_ids', ids)}
      />
      {f.everywhere ? null : (
        <input
          aria-label={t('offerEditor.areaLabel')}
          value={f.area ?? ''}
          maxLength={80}
          onChange={(e) => set('area', e.target.value)}
          placeholder={t('offerEditor.areaPlaceholder')}
          className={cn(fieldInput, '-mt-3')}
        />
      )}

      {objective === 'ambassador' ? (
        <div>
          <p className={fieldLabel}>{t('offerEditor.whoFor')}</p>
          <p className={cn('text-row', needsOpen ? 'text-status-warning' : 'text-ink-2')} data-testid="offer-ambassador-note">
            {needsOpen ? t('offerEditor.ambassadorNeedsOpen') : t('offerEditor.ambassadorPlayersOnly')}
          </p>
        </div>
      ) : (
      <fieldset>
        <legend className={fieldLabel}>{t('offerEditor.whoFor')}</legend>
        <div className="flex flex-wrap gap-2">
          {OFFER_ROLES.map((r) => {
            const on = f.roles.includes(r.value)
            return (
              <button
                key={r.value}
                type="button"
                aria-pressed={on}
                onClick={() => set('roles', on ? f.roles.filter((x) => x !== r.value) : [...f.roles, r.value as OfferRole])}
                className={cn('h-9 rounded-full px-4 text-row font-semibold', chipTone(on))}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </fieldset>
      )}
      <ReachLine fields={f} />

      <div className="space-y-4">
        <div>
          <div className={fieldLabelRow}><label htmlFor="offer-start">{t('offerEditor.startsLabel')}</label><span className={fieldOptionalTag}>{t('offerEditor.optional')}</span></div>
          <input id="offer-start" type="date" value={toDateInput(f.starts_at)} onChange={(e) => set('starts_at', fromDateInput(e.target.value, false))} className={fieldInput} />
          <p className="mt-1.5 text-caption text-ink-3">{f.starts_at ? '' : t('offerEditor.startsHint')}</p>
        </div>
        <div>
          <label htmlFor="offer-end" className={fieldLabel}>{t('offerEditor.endsLabel')}</label>
          <input
            id="offer-end"
            type="date"
            value={toDateInput(f.ends_at)}
            min={toDateInput(campaignEnd(start, CAMPAIGN_MIN_DAYS))}
            max={toDateInput(campaignEnd(start, CAMPAIGN_MAX_DAYS))}
            onChange={(e) => set('ends_at', fromDateInput(e.target.value, true))}
            className={fieldInput}
            data-testid="offer-end-input"
          />
          <p className="mt-1.5 text-caption text-ink-3">{t('offerEditor.endsHint', { min: CAMPAIGN_MIN_DAYS, max: CAMPAIGN_MAX_DAYS, days: CAMPAIGN_DEFAULT_DAYS })}</p>
        </div>
      </div>
      </>) : null}
    </div>
  )

  // Rebrand page 27 · Web · Offers editor (736): form + a 260 "How members
  // see it" column, then one publish row (note · Save draft · Publish).
  if (layout === 'desktop') {
    return (
      <div className="rounded-[24px] bg-white p-6 ring-1 ring-inset ring-line" data-testid="offer-editor">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="font-display text-[24px] font-bold leading-[1.2] text-ink-1">{title}</h2>
          <div className="flex items-center gap-3">
            {offer ? <OfferPill offer={offer} /> : null}
            <button type="button" onClick={onCancel} className="flex h-11 items-center px-1 text-[14px] font-semibold text-ink-2 hover:text-ink-1">{t('offerEditor.close')}</button>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_260px] items-start gap-6">
          {form}
          <div className="sticky top-24 space-y-2.5">
            <p className="text-[14px] font-medium leading-[1.3] text-ink-1">{t('offerEditor.previewTitle')}</p>
            {preview}
          </div>
        </div>
        <div className="mt-6 flex items-center gap-4 border-t border-line pt-5">
          <div className="min-w-0 flex-1">
            {tried && missing ? <p className="text-secondary text-status-danger" role="alert">{missing}</p> : null}
            <p className="text-secondary text-ink-2">
              {isChange ? t('offerEditor.noteChangesDesktop') : t('offerEditor.noteNew')}
            </p>
          </div>
          {!isChange ? (
            <Button variant="secondary" className="rounded-full" onClick={() => onSave(f, false)} loading={saving === 'draft'} disabled={busy}>{t('offerEditor.saveDraft')}</Button>
          ) : null}
          <Button className="rounded-full" onClick={submit} loading={saving === 'submit'} disabled={busy} data-testid="offer-send">
            {isChange ? t('offerEditor.publishChanges') : t('offerEditor.publish')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    // A focused field half under the sticky top bar or the fixed Send bar is
    // scrolled clear. Measured by hand: browsers don't scroll a field that is
    // partly on screen, and scrollIntoView has no effect inside this layout.
    <div
      className="min-h-screen bg-surface-subtle pb-48"
      onFocusCapture={(e) => {
        const el = e.target
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
        const r = el.getBoundingClientRect()
        const top = (topBar.current?.getBoundingClientRect().bottom ?? 0) + 12
        const bottom = (bottomBar.current?.getBoundingClientRect().top ?? window.innerHeight) - 12
        if (r.bottom > bottom) window.scrollBy({ top: r.bottom - bottom, behavior: 'smooth' })
        else if (r.top < top) window.scrollBy({ top: r.top - top, behavior: 'smooth' })
      }}
      data-testid="offer-editor"
    >
      <div ref={topBar} className="sticky top-0 z-10 flex h-[calc(env(safe-area-inset-top)+44px)] items-end justify-between bg-surface-subtle/95 px-2 pb-0 pt-[env(safe-area-inset-top)] backdrop-blur">
        <button type="button" onClick={onCancel} className="flex h-11 items-center px-3 text-body text-brand-primary">{t('offerEditor.cancel')}</button>
        <h1 className="text-body font-semibold text-ink-1">{title}</h1>
        {isChange ? (
          <span className="w-[76px]" />
        ) : (
          <button type="button" onClick={() => onSave(f, false)} disabled={busy} className="flex h-11 items-center px-3 text-body font-semibold text-brand-primary disabled:opacity-40" data-testid="offer-save-draft">
            {saving === 'draft' ? t('offerEditor.saving') : t('offerEditor.saveDraft')}
          </button>
        )}
      </div>
      <div className="space-y-8 px-5 pt-4">
        {form}
        <div>
          <p className="mb-2 text-secondary font-semibold text-ink-2">{t('offerEditor.previewTitle')}</p>
          {preview}
        </div>
      </div>
      <div ref={bottomBar} className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        {actions}
      </div>
    </div>
  )
}

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
/** A day picked in the date field: starts at 00:00, ends at 23:59 (UTC). */
const fromDateInput = (day: string, end: boolean) => (day ? `${day}T${end ? '23:59:59' : '00:00:00'}Z` : null)

function PhotoField({ url, userId, onChange }: { url: string | null; userId: string; onChange: (url: string | null) => void }) {
  const t = useBrandsT()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const check = validateImage(file, { maxFileSizeMB: 15 })
      if (!check.valid) throw new Error(check.error)
      const img = await optimizeImage(file, { maxWidth: 2000, maxHeight: 2000, maxSizeMB: 2.5, quality: 0.9 })
      const ext = img.type === 'image/png' ? 'png' : 'jpg'
      const path = `${userId}/offer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, img, { contentType: img.type, upsert: false, cacheControl: '31536000' })
      if (upErr) throw upErr
      onChange(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    } catch (err) {
      logger.error('[OfferEditor] photo upload failed', err)
      setError(t('offerEditor.photoFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className={fieldLabel}>{t('offerEditor.photoLabel')}</p>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[20px]">
        <OfferThumb url={url} className="absolute inset-0 h-full w-full" />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="absolute bottom-3 left-3 inline-flex h-9 items-center gap-2 rounded-full bg-black/40 px-4 text-row font-semibold text-white backdrop-blur-sm"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {url ? t('offerEditor.changePhoto') : t('offerEditor.addPhoto')}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
      <p className={cn('mt-1.5 text-caption', error ? 'text-status-danger' : 'text-ink-3')}>{error ?? t('offerEditor.photoHint')}</p>
    </div>
  )
}

/** "Where members live" (2026-11-07): Everywhere, whole regions, or countries. */
function PlaceField({ everywhere, regions, countryIds, names, onEverywhere, onRegions, onCountries }: {
  everywhere: boolean
  regions: string[]
  countryIds: number[]
  names: string[]
  onEverywhere: (on: boolean) => void
  onRegions: (regions: string[]) => void
  onCountries: (ids: number[]) => void
}) {
  const t = useBrandsT()
  const { countries } = useCountries()
  const [open, setOpen] = useState<'country' | 'region' | null>(null)
  const [q, setQ] = useState('')
  const results = useMemo(() => searchCountries(countries, q).filter((c) => !countryIds.includes(c.id)).slice(0, 80), [countries, q, countryIds])
  const close = () => { setOpen(null); setQ('') }
  const removable = 'inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-soft pl-4 pr-2 text-row font-semibold text-brand-primary'
  const addChip = cn('inline-flex h-9 items-center gap-1 rounded-full px-4 text-row font-semibold', chipTone(false))

  return (
    <div>
      <p className={fieldLabel}>{t('offerEditor.placeLabel')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={everywhere} onClick={() => onEverywhere(!everywhere)} className={cn('h-9 rounded-full px-4 text-row font-semibold', chipTone(everywhere))} data-testid="offer-everywhere">
          {t('offerEditor.everywhere')}
        </button>
        {everywhere ? null : (
          <>
            {regions.map((r) => (
              <span key={r} className={removable}>
                {offerRegionLabel(r)}
                <button type="button" aria-label={t('offerEditor.removeItem', { name: offerRegionLabel(r) })} onClick={() => onRegions(regions.filter((x) => x !== r))} className="flex h-7 w-7 items-center justify-center rounded-full">
                  <X className="h-4 w-4" />
                </button>
              </span>
            ))}
            {countryIds.map((id, i) => (
              <span key={id} className={removable}>
                {names[i] ?? '…'}
                <button type="button" aria-label={names[i] ? t('offerEditor.removeItem', { name: names[i] }) : t('offerEditor.removeCountry')} onClick={() => onCountries(countryIds.filter((v) => v !== id))} className="flex h-7 w-7 items-center justify-center rounded-full">
                  <X className="h-4 w-4" />
                </button>
              </span>
            ))}
            {regions.length < OFFER_REGIONS.length ? (
              <button type="button" onClick={() => setOpen('region')} className={addChip} data-testid="offer-add-region">
                <Plus className="h-4 w-4" /> {t('offerEditor.addRegion')}
              </button>
            ) : null}
            {countryIds.length < MAX_COUNTRIES ? (
              <button type="button" onClick={() => setOpen('country')} className={addChip} data-testid="offer-add-country">
                <Plus className="h-4 w-4" /> {t('offerEditor.addCountry')}
              </button>
            ) : null}
          </>
        )}
      </div>
      <p className="mt-1.5 text-caption text-ink-3">
        {everywhere
          ? t('offerEditor.placeHintEverywhere')
          : t('offerEditor.placeHint')}
      </p>

      <BottomSheet open={open === 'region'} onClose={close} ariaLabel={t('offerEditor.addRegion')}>
        <div className="px-5 pb-3 pt-1"><h2 className="text-title text-ink-1">{t('offerEditor.addRegion')}</h2></div>
        <ul className="max-h-[50dvh] overflow-y-auto px-2 pb-3">
          {OFFER_REGIONS.filter((r) => !regions.includes(r)).map((r) => (
            <li key={r}>
              <button type="button" onClick={() => { onRegions([...regions, r]); close() }} className="flex h-12 w-full items-center rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted">
                {offerRegionLabel(r)}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>

      <BottomSheet open={open === 'country'} onClose={close} ariaLabel={t('offerEditor.addCountry')}>
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">{t('offerEditor.addCountry')}</h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('offerEditor.searchCountries')} aria-label={t('offerEditor.searchCountriesLabel')} className={cn(fieldInput, 'pl-10')} />
          </div>
        </div>
        <ul className="max-h-[50dvh] overflow-y-auto px-2 pb-3">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { onCountries([...countryIds, c.id]); close() }}
                className="flex h-12 w-full items-center rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted"
              >
                {countryLabel(c.common_name || c.name)}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  )
}

/** How many members the offer reaches today, before publishing (counts under 5 hidden). */
function ReachLine({ fields }: { fields: OfferFields }) {
  const t = useBrandsT()
  const key = {
    everywhere: fields.everywhere ?? false,
    regions: [...(fields.regions ?? [])].sort(),
    country_ids: [...fields.country_ids].sort((a, b) => a - b),
    roles: [...fields.roles].sort(),
    area: (fields.area ?? '').trim().toLowerCase(),
  }
  const [debounced, setDebounced] = useState(key)
  const keyText = JSON.stringify(key)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(JSON.parse(keyText) as typeof key), 400)
    return () => window.clearTimeout(timer)
  }, [keyText])
  const ready = debounced.roles.length > 0 && (debounced.everywhere || debounced.regions.length > 0 || debounced.country_ids.length > 0)
  const q = useQuery({
    queryKey: ['brand-offer-reach', debounced],
    enabled: ready,
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchOfferReach(debounced),
  })
  if (!ready) return null
  const text = q.isError ? null : reachLine(q.data ?? null, debounced.roles as OfferRole[])
  return (
    <p className="-mt-2 rounded-[12px] bg-surface-subtle px-3.5 py-2.5 text-row text-ink-1" aria-live="polite" data-testid="offer-reach">
      {q.isLoading ? t('offerEditor.counting') : text ?? t('offerEditor.reachUnavailable')}
    </p>
  )
}
