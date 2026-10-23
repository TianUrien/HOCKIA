import { useMemo, useRef, useState } from 'react'
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
  OFFER_BODY_MAX,
  OFFER_ROLES,
  OFFER_TITLE_MAX,
  offerMissing,
  unprovableClaim,
  type BrandOffer,
  type OfferFields,
  type OfferRole,
} from '@/lib/brandOffers'
import { OfferPreviewCard, OfferThumb, OfferPill } from './OfferParts'
import { useCountryNames } from '@/hooks/useCountryNames'

const BUCKET = 'brand-products'
const MAX_COUNTRIES = 30

interface OfferEditorProps {
  /** The offer being edited; null for a new one. */
  offer: BrandOffer | null
  initial: OfferFields
  brandName: string
  userId: string
  saving: 'draft' | 'submit' | null
  onSave: (fields: OfferFields, submit: boolean) => void
  onCancel: () => void
  layout: 'phone' | 'desktop'
}

/**
 * Create / edit an offer (Figma B2 phone, D1 desktop panel). Live and paused
 * offers can only send a change for review ("The live version stays up until
 * the changes are approved"); everything else can also be saved as a draft.
 */
export function OfferEditor({ offer, initial, brandName, userId, saving, onSave, onCancel, layout }: OfferEditorProps) {
  const [f, setF] = useState<OfferFields>(initial)
  const [tried, setTried] = useState(false)
  const set = <K extends keyof OfferFields>(key: K, value: OfferFields[K]) => setF((prev) => ({ ...prev, [key]: value }))
  const names = useCountryNames()
  const countryNames = names(f.country_ids)

  const isChange = offer?.status === 'live' || offer?.status === 'paused'
  const missing = offerMissing(f)
  const claim = unprovableClaim(`${f.title ?? ''} ${f.body ?? ''}`)
  const busy = saving !== null
  const title = offer ? (layout === 'desktop' ? `Edit · ${offer.title ?? 'offer'}` : 'Edit offer') : 'New offer'

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
        {isChange ? 'Send changes for review' : 'Send for review'}
      </Button>
      {layout === 'desktop' && !isChange ? (
        <Button block variant="tonal" onClick={() => onSave(f, false)} loading={saving === 'draft'} disabled={busy}>Save draft</Button>
      ) : null}
      <p className="text-secondary text-ink-2">
        {isChange ? 'The live version stays up until the changes are approved.' : 'An admin checks it before it goes live. You can edit it until then.'}
      </p>
    </div>
  )

  const form = (
    <div className="space-y-6">
      <PhotoField url={f.image_url} userId={userId} onChange={(url) => set('image_url', url)} />

      <div>
        <div className={fieldLabelRow}><label htmlFor="offer-title">Title</label></div>
        <div className="relative">
          <input
            id="offer-title"
            value={f.title ?? ''}
            maxLength={OFFER_TITLE_MAX}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Kit for your first season abroad"
            className={cn(fieldInput, 'pr-16')}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-caption text-ink-3">{(f.title ?? '').length}/{OFFER_TITLE_MAX}</span>
        </div>
      </div>

      <div>
        <div className={fieldLabelRow}><label htmlFor="offer-body">What members get</label></div>
        <div className="relative">
          <textarea
            id="offer-body"
            value={f.body ?? ''}
            maxLength={OFFER_BODY_MAX}
            rows={3}
            onChange={(e) => set('body', e.target.value)}
            placeholder="15% off your first full kit when you join a club in a new country."
            className={cn(fieldInput, 'h-auto resize-none py-3 pr-16')}
          />
          <span className="pointer-events-none absolute right-3.5 top-3 text-caption text-ink-3">{(f.body ?? '').length}/{OFFER_BODY_MAX}</span>
        </div>
        <p className={cn('mt-1.5 text-caption', claim ? 'text-status-warning' : 'text-ink-3')}>
          {claim
            ? `"${claim}" is a claim an admin can't check. Say exactly what a member gets instead.`
            : 'Say exactly what a member gets. No claims you can’t back up, like "best" or "cheapest".'}
        </p>
      </div>

      <div>
        <label htmlFor="offer-link" className={fieldLabel}>Link</label>
        <input
          id="offer-link"
          value={f.link_url ?? ''}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => set('link_url', e.target.value)}
          placeholder="yourbrand.com/hockia"
          className={fieldInput}
        />
        <p className="mt-1.5 text-caption text-ink-3">Members open this page from the offer.</p>
      </div>

      <CountriesField value={f.country_ids} onChange={(ids) => set('country_ids', ids)} names={countryNames} />
      <input
        aria-label="Region or city (optional)"
        value={f.area ?? ''}
        maxLength={80}
        onChange={(e) => set('area', e.target.value)}
        placeholder="Optional: region or city"
        className={cn(fieldInput, '-mt-3')}
      />

      <fieldset>
        <legend className={fieldLabel}>Who it&rsquo;s for</legend>
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

      <div className="space-y-4">
        <div>
          <div className={fieldLabelRow}><label htmlFor="offer-start">Starts</label><span className={fieldOptionalTag}>Optional</span></div>
          <input id="offer-start" type="date" value={toDateInput(f.starts_at)} onChange={(e) => set('starts_at', fromDateInput(e.target.value, false))} className={fieldInput} />
          <p className="mt-1.5 text-caption text-ink-3">{f.starts_at ? '' : 'When approved'}</p>
        </div>
        <div>
          <div className={fieldLabelRow}><label htmlFor="offer-end">Ends</label><span className={fieldOptionalTag}>Optional</span></div>
          <input id="offer-end" type="date" value={toDateInput(f.ends_at)} onChange={(e) => set('ends_at', fromDateInput(e.target.value, true))} className={fieldInput} />
        </div>
      </div>
    </div>
  )

  if (layout === 'desktop') {
    return (
      <div className="rounded-[24px] bg-white p-8 shadow-[0_1px_2px_rgba(15,15,20,0.06)]" data-testid="offer-editor">
        <div className="mb-6 flex items-start justify-between gap-4">
          <h2 className="text-title text-ink-1">{title}</h2>
          <div className="flex items-center gap-3">
            {offer ? <OfferPill offer={offer} /> : null}
            <button type="button" onClick={onCancel} className="text-row font-semibold text-ink-2">Close</button>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-8">
          {form}
          <div className="space-y-4">
            <p className="text-secondary font-semibold text-ink-2">How members see it</p>
            {preview}
            {actions}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-subtle pb-40" data-testid="offer-editor">
      <div className="sticky top-0 z-10 flex h-[calc(env(safe-area-inset-top)+44px)] items-end justify-between bg-surface-subtle/95 px-2 pb-0 pt-[env(safe-area-inset-top)] backdrop-blur">
        <button type="button" onClick={onCancel} className="flex h-11 items-center px-3 text-body text-brand-primary">Cancel</button>
        <h1 className="text-body font-semibold text-ink-1">{title}</h1>
        {isChange ? (
          <span className="w-[76px]" />
        ) : (
          <button type="button" onClick={() => onSave(f, false)} disabled={busy} className="flex h-11 items-center px-3 text-body font-semibold text-brand-primary disabled:opacity-40" data-testid="offer-save-draft">
            {saving === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
        )}
      </div>
      <div className="space-y-8 px-5 pt-4">
        {form}
        <div>
          <p className="mb-2 text-secondary font-semibold text-ink-2">How members see it</p>
          {preview}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        {actions}
      </div>
    </div>
  )
}

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
/** A day picked in the date field: starts at 00:00, ends at 23:59 (UTC). */
const fromDateInput = (day: string, end: boolean) => (day ? `${day}T${end ? '23:59:59' : '00:00:00'}Z` : null)

function PhotoField({ url, userId, onChange }: { url: string | null; userId: string; onChange: (url: string | null) => void }) {
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
      setError('The photo could not be uploaded. Try another one.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className={fieldLabel}>Photo</p>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[20px]">
        <OfferThumb url={url} className="absolute inset-0 h-full w-full" />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="absolute bottom-3 left-3 inline-flex h-9 items-center gap-2 rounded-full bg-black/40 px-4 text-row font-semibold text-white backdrop-blur-sm"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {url ? 'Change photo' : 'Add photo'}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
      <p className={cn('mt-1.5 text-caption', error ? 'text-status-danger' : 'text-ink-3')}>{error ?? 'A real photo of the product or service. No text on the image.'}</p>
    </div>
  )
}

function CountriesField({ value, onChange, names }: { value: number[]; onChange: (ids: number[]) => void; names: string[] }) {
  const { countries } = useCountries()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const results = useMemo(() => searchCountries(countries, q).filter((c) => !value.includes(c.id)).slice(0, 80), [countries, q, value])

  return (
    <div>
      <p className={fieldLabel}>Where members live</p>
      <div className="flex flex-wrap gap-2">
        {value.map((id, i) => (
          <span key={id} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-soft pl-4 pr-2 text-row font-semibold text-brand-primary">
            {names[i] ?? '…'}
            <button type="button" aria-label={`Remove ${names[i] ?? 'country'}`} onClick={() => onChange(value.filter((v) => v !== id))} className="flex h-7 w-7 items-center justify-center rounded-full">
              <X className="h-4 w-4" />
            </button>
          </span>
        ))}
        {value.length < MAX_COUNTRIES ? (
          <button type="button" onClick={() => setOpen(true)} className={cn('inline-flex h-9 items-center gap-1 rounded-full px-4 text-row font-semibold', chipTone(false))} data-testid="offer-add-country">
            <Plus className="h-4 w-4" /> Add country
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-caption text-ink-3">Offers reach members by where they live, never by nationality.</p>

      <BottomSheet open={open} onClose={() => { setOpen(false); setQ('') }} ariaLabel="Add country">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">Add country</h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search countries" aria-label="Search countries" className={cn(fieldInput, 'pl-10')} />
          </div>
        </div>
        <ul className="max-h-[50dvh] overflow-y-auto px-2 pb-3">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { onChange([...value, c.id]); setOpen(false); setQ('') }}
                className="flex h-12 w-full items-center rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted"
              >
                {c.common_name || c.name}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  )
}
