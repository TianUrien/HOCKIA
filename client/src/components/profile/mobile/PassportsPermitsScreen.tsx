import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { CountrySelect } from '@/components'
import { CancelSaveBar, GroupCard, SectionLabel } from './formScreenUi'
import { PermitAttentionRow } from '@/components/profile/KeyFactsGrid'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { invalidateProfile } from '@/lib/profile'
import { useCountries } from '@/hooks/useCountries'
import { useWorkPermits } from '@/hooks/useWorkPermits'
import { passportInputs, permitInputs } from '@/hooks/useProfileKeyFacts'
import { buildPlayerKeyFacts, formatMonth } from '@/lib/keyFacts'
import {
  MAX_WORK_PERMITS,
  WORK_PERMIT_TYPES,
  WORK_PERMIT_TYPE_LABELS,
  needsPermitAttention,
  validateWorkPermitDraft,
  workPermitStatus,
  workPermitTypeLabel,
  type WorkPermitDraftError,
  type WorkPermitStatus,
} from '@/lib/workPermits'
import { cn } from '@/lib/utils'
import { tProfileEdit, useProfileEditT } from '@/i18n/ns/profileEdit'

/**
 * Passports & permits (Figma D2.3 395:563). Up to two passports (the two
 * nationality fields); EU status is computed from them, never typed. Visas &
 * work permits: country, type (visa / work permit / residency), optional start
 * date, OPTIONAL expiry — no expiry = valid. Max 10. The card at the bottom
 * previews the one passport line clubs see. An amber row flags a permit that
 * expires within 30 days or has expired (no email / push).
 *
 * Everything is staged on this screen and written on Save; Cancel drops it.
 */
interface PassportsPermitsScreenProps {
  onDone: () => void
}

type PermitDraftRow = {
  key: string
  id: string | null
  country_id: number | null
  type: string | null
  valid_from: string
  expires_on: string
}

function draftErrorText(code: WorkPermitDraftError): string {
  switch (code) {
    case 'country_required': return tProfileEdit('passports.errors.countryRequired')
    case 'type_invalid': return tProfileEdit('passports.errors.typeInvalid')
    case 'date_invalid': return tProfileEdit('passports.errors.dateInvalid')
    case 'dates_out_of_order': return tProfileEdit('passports.errors.datesOutOfOrder')
  }
}

const input = 'h-[50px] w-full rounded-[12px] bg-surface-grouped px-3.5 text-body text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30'
const fieldLabel = 'mb-1.5 block text-secondary font-semibold text-ink-2'

let draftSeq = 0
const newKey = () => `new-${++draftSeq}`

function permitSubtitle(type: string | null, validFrom: string, expiresOn: string, status: WorkPermitStatus): string {
  const until = formatMonth(expiresOn)
  const from = formatMonth(validFrom)
  const label = workPermitTypeLabel(type)
  if (status === 'expired') return until ? tProfileEdit('passports.subtitle.expired', { type: label, until }) : tProfileEdit('passports.subtitle.expiredNoDate', { type: label })
  if (status === 'not_yet_valid' && from) return until ? tProfileEdit('passports.subtitle.fromUntil', { type: label, from, until }) : tProfileEdit('passports.subtitle.from', { type: label, from })
  return until ? tProfileEdit('passports.subtitle.until', { type: label, until }) : tProfileEdit('passports.subtitle.noExpiry', { type: label })
}

export default function PassportsPermitsScreen({ onDone }: PassportsPermitsScreenProps) {
  const t = useProfileEditT()
  const { user, profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const { countries, getCountryById } = useCountries()
  const work = useWorkPermits(profile?.id ?? null)

  const [passports, setPassports] = useState<(number | null)[]>([profile?.nationality_country_id ?? null, profile?.nationality2_country_id ?? null])
  const [permits, setPermits] = useState<PermitDraftRow[] | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [passportSheet, setPassportSheet] = useState<0 | 1 | null>(null)
  const [passportPick, setPassportPick] = useState<number | null>(null)
  const [permitSheet, setPermitSheet] = useState<PermitDraftRow | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  // The permit sheet's last failed check. The message shows only while that
  // same check still fails, so it clears the moment the field is fixed.
  const [permitErrorCode, setPermitErrorCode] = useState<WorkPermitDraftError | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the permit draft once the owner's rows have loaded.
  useEffect(() => {
    if (permits !== null || work.loading) return
    setPermits(work.permits.map((p) => ({ key: p.id, id: p.id, country_id: p.country_id, type: p.type, valid_from: p.valid_from ?? '', expires_on: p.expires_on ?? '' })))
  }, [permits, work.loading, work.permits])

  const heldPassports = useMemo(() => passports.filter((id): id is number => typeof id === 'number'), [passports])
  const draftPermits = useMemo(() => permits ?? [], [permits])
  const today = useMemo(() => new Date(), [])

  // The one line clubs see — built exactly like the recruiter tile.
  const preview = useMemo(() => {
    const fact = buildPlayerKeyFacts({
      position: null, secondaryPosition: null, currentClubName: null, league: null,
      availableFrom: null, availabilityDuration: null,
      passports: passportInputs(heldPassports, countries),
      permits: permitInputs(draftPermits.filter((p) => p.country_id && p.type).map((p) => ({
        id: p.key, player_id: '', country_id: p.country_id as number, type: p.type as string,
        valid_from: p.valid_from || null, expires_on: p.expires_on || null, created_at: '', updated_at: '',
        status: workPermitStatus(p.valid_from || null, p.expires_on || null, today),
      })), countries),
      fullMatchCount: 0, highlightCount: 0, age: null,
    }, { viewer: 'recruiter', today }).find((f) => f.id === 'passport')
    if (!fact) return { main: t('passports.screen.previewNotGiven'), lines: [] as string[] }
    return { main: fact.missing ? t('passports.screen.previewPassportNotGiven') : [fact.value, fact.detail].filter(Boolean).join(' · '), lines: fact.extraLines.map((l) => l.text) }
  }, [heldPassports, draftPermits, countries, today, t])

  if (!profile || !user) return null

  const hasEu = passportInputs(heldPassports, countries).some((p) => p.isEu)
  const countryLabel = (id: number | null) => {
    const c = getCountryById(id)
    return c ? [c.flag_emoji, c.common_name || c.name].filter(Boolean).join(' ') : t('passports.screen.chooseCountry')
  }
  const attention = draftPermits
    .map((p) => ({ p, status: workPermitStatus(p.valid_from || null, p.expires_on || null, today) }))
    .filter(({ p, status }) => p.id && needsPermitAttention(status))

  const openPassport = (index: 0 | 1) => { setPassportPick(passports[index]); setSheetError(null); setPassportSheet(index) }
  const applyPassport = () => {
    if (passportSheet === null) return
    if (!passportPick) { setSheetError(t('passports.errors.chooseCountry')); return }
    const other = passports[passportSheet === 0 ? 1 : 0]
    if (other === passportPick) { setSheetError(t('passports.errors.duplicate')); return }
    const next = [...passports]
    next[passportSheet] = passportPick
    setPassports(next)
    setPassportSheet(null)
  }
  const removePassport = () => {
    if (passportSheet === null) return
    const next = [...passports]
    next[passportSheet] = null
    // The remaining passport becomes the primary one.
    setPassports(next[0] === null ? [next[1], null] : next)
    setPassportSheet(null)
  }

  const openPermit = (row: PermitDraftRow | null) => {
    setPermitErrorCode(null)
    setPermitSheet(row ? { ...row } : { key: newKey(), id: null, country_id: null, type: null, valid_from: '', expires_on: '' })
  }
  const applyPermit = () => {
    if (!permitSheet) return
    const invalid = validateWorkPermitDraft({ country_id: permitSheet.country_id, type: permitSheet.type, valid_from: permitSheet.valid_from, expires_on: permitSheet.expires_on })
    if (invalid) { setPermitErrorCode(invalid); return }
    setPermits((prev) => {
      const list = prev ?? []
      return list.some((p) => p.key === permitSheet.key) ? list.map((p) => (p.key === permitSheet.key ? permitSheet : p)) : [...list, permitSheet]
    })
    setPermitSheet(null)
  }
  const permitError = permitSheet && permitErrorCode
    && validateWorkPermitDraft({ country_id: permitSheet.country_id, type: permitSheet.type, valid_from: permitSheet.valid_from, expires_on: permitSheet.expires_on }) === permitErrorCode
    ? draftErrorText(permitErrorCode)
    : null
  const removePermit = () => {
    if (!permitSheet) return
    if (permitSheet.id) setRemoved((r) => [...r, permitSheet.id as string])
    setPermits((prev) => (prev ?? []).filter((p) => p.key !== permitSheet.key))
    setPermitSheet(null)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const [first, second] = passports
      if (first !== (profile.nationality_country_id ?? null) || second !== (profile.nationality2_country_id ?? null)) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ nationality_country_id: first, nationality2_country_id: second, nationality: first ? getCountryById(first)?.nationality_name ?? profile.nationality ?? '' : '' })
          .eq('id', user.id)
        if (updateError) throw updateError
        invalidateProfile({ userId: user.id, reason: 'passports-permits' })
        await refreshProfile()
      }
      if (work.available) {
        for (const id of removed) {
          const r = await work.removePermit(id)
          if (!r.ok) throw r.error ?? new Error(r.reason)
        }
        const original = new Map(work.permits.map((p) => [p.id, p]))
        for (const p of draftPermits) {
          const draft = { country_id: p.country_id, type: p.type, valid_from: p.valid_from || null, expires_on: p.expires_on || null }
          if (!p.id) {
            const r = await work.addPermit(draft)
            if (!r.ok) throw r.error ?? new Error(r.reason)
            continue
          }
          const was = original.get(p.id)
          if (was && (was.country_id !== p.country_id || was.type !== p.type || (was.valid_from ?? '') !== p.valid_from || (was.expires_on ?? '') !== p.expires_on)) {
            const r = await work.updatePermit(p.id, draft)
            if (!r.ok) throw r.error ?? new Error(r.reason)
          }
        }
        // Permits change the completeness score server-side.
        if (removed.length || draftPermits.some((p) => !p.id)) void refreshProfile()
      }
      addToast(t('passports.screen.saved'), 'success')
      onDone()
    } catch (err) {
      logger.error('[PassportsPermitsScreen] save failed', err)
      setError(t('passports.errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-white pt-[env(safe-area-inset-top)] pb-28" data-testid="passports-permits-screen">
      <CancelSaveBar title={t('passports.screen.title')} onCancel={onDone} onSave={() => void save()} saving={saving} />

      <div className="flex flex-col gap-3 px-5 pt-3">
        <p className="text-[15px] leading-[21px] text-ink-2">{t('passports.screen.intro')}</p>

        {attention.map(({ p, status }) => {
          const c = getCountryById(p.country_id)
          return (
            <PermitAttentionRow
              key={p.key}
              permit={{ id: p.key, type: p.type ?? '', expires_on: p.expires_on || null, status, countryName: c ? c.common_name || c.name : t('passports.screen.unknownCountry'), flag: c?.flag_emoji ?? null }}
              onClick={() => openPermit(p)}
            />
          )
        })}

        <SectionLabel>{t('passports.screen.passports')}</SectionLabel>
        <GroupCard>
          {heldPassports.map((id, i) => (
            <button key={id} type="button" onClick={() => openPassport(i as 0 | 1)} className="flex items-center gap-2.5 py-[13px] text-left">
              <span className="min-w-0 flex-1 truncate text-[16px] leading-[21px] text-ink-1">{countryLabel(id)}</span>
              <span className="text-row text-ink-2">{i === 0 ? t('passports.screen.primary') : t('passports.screen.second')}</span>
              <ChevronRight className="h-4 w-4 text-ink-4" strokeWidth={2} />
            </button>
          ))}
          {heldPassports.length < 2 && (
            <button type="button" onClick={() => openPassport(heldPassports.length as 0 | 1)} className="py-[13px] text-left text-[16px] font-semibold leading-[21px] text-hockia-primary">
              {heldPassports.length === 0 ? t('passports.screen.addFirst') : t('passports.screen.addAnother')}
            </button>
          )}
        </GroupCard>
        <p className="text-secondary text-ink-2">
          {hasEu ? t('passports.screen.euHeld') : t('passports.screen.euMissing')}
        </p>

        <SectionLabel>{t('passports.screen.permitsLabel')}</SectionLabel>
        {work.available ? (
          <GroupCard>
            {draftPermits.map((p) => {
              const status = workPermitStatus(p.valid_from || null, p.expires_on || null, today)
              const amber = needsPermitAttention(status)
              return (
                <button key={p.key} type="button" onClick={() => openPermit(p)} className="flex items-center gap-2.5 py-3 text-left" data-testid="permit-row">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] leading-[21px] text-ink-1">{countryLabel(p.country_id)}</span>
                    <span className={cn('block text-secondary', amber ? 'font-semibold text-amber-600' : 'text-ink-2')}>{permitSubtitle(p.type, p.valid_from, p.expires_on, status)}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-4" strokeWidth={2} />
                </button>
              )
            })}
            {draftPermits.length < MAX_WORK_PERMITS ? (
              <button type="button" onClick={() => openPermit(null)} className="py-[13px] text-left text-[16px] font-semibold leading-[21px] text-hockia-primary">{t('passports.screen.addPermit')}</button>
            ) : (
              <p className="py-[13px] text-secondary text-ink-2">{t('passports.screen.maxReached', { max: MAX_WORK_PERMITS })}</p>
            )}
          </GroupCard>
        ) : (
          <GroupCard><p className="py-[13px] text-secondary text-ink-2">{t('passports.screen.unavailable')}</p></GroupCard>
        )}
        <p className="text-secondary text-ink-2">{t('passports.screen.permitsHint')}</p>

        <div className="flex flex-col gap-1.5 rounded-card border border-line p-3.5" data-testid="clubs-see-preview">
          <p className="text-caption text-ink-2">{t('passports.screen.previewLabel')}</p>
          <p className="text-row font-semibold text-ink-1">{preview.main}</p>
          {preview.lines.map((l) => <p key={l} className="text-secondary text-ink-1">{l}</p>)}
        </div>

        {error && <p role="alert" className="text-secondary text-red-600">{error}</p>}
      </div>

      <BottomSheet open={passportSheet !== null} onClose={() => setPassportSheet(null)} ariaLabel={t('passports.sheet.passportAria')}>
        <div className="flex flex-col gap-4 px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">{passportSheet === 1 ? t('passports.sheet.secondTitle') : t('passports.sheet.passportTitle')}</h2>
          <CountrySelect appearance="field" label={t('passports.sheet.country')} value={passportPick} onChange={(id) => { setPassportPick(id); setSheetError(null) }} />
          <p className="text-caption text-ink-3">{t('passports.sheet.euHint')}</p>
          {sheetError && <p role="alert" className="text-secondary text-red-600">{sheetError}</p>}
          <button type="button" onClick={applyPassport} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white">{t('passports.sheet.done')}</button>
          {passportSheet !== null && passports[passportSheet] !== null && (
            <button type="button" onClick={removePassport} className="h-11 text-row font-semibold text-red-600">{t('passports.sheet.removePassport')}</button>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={permitSheet !== null} onClose={() => setPermitSheet(null)} ariaLabel={t('passports.sheet.permitAria')}>
        {permitSheet && (
          <div className="flex flex-col gap-4 px-5 pb-3 pt-1">
            <h2 className="text-title text-ink-1">{permitSheet.id || draftPermits.some((p) => p.key === permitSheet.key) ? t('passports.sheet.permitTitle') : t('passports.sheet.addPermitTitle')}</h2>
            <CountrySelect appearance="field" label={t('passports.sheet.permitCountry')} value={permitSheet.country_id} onChange={(id) => setPermitSheet({ ...permitSheet, country_id: id })} />
            <div>
              <span className={fieldLabel}>{t('passports.sheet.type')}</span>
              <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped" role="radiogroup" aria-label={t('passports.sheet.type')}>
                {WORK_PERMIT_TYPES.map((type) => (
                  <button key={type} type="button" role="radio" aria-checked={permitSheet.type === type} onClick={() => setPermitSheet({ ...permitSheet, type })} className="flex h-[50px] w-full items-center justify-between px-4 text-left text-body text-ink-1">
                    {WORK_PERMIT_TYPE_LABELS[type]}
                    <span className={cn('h-5 w-5 rounded-full border-2', permitSheet.type === type ? 'border-hockia-primary bg-hockia-primary shadow-[inset_0_0_0_3px_white]' : 'border-line')} />
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="permit-from" className={fieldLabel}>{t('passports.sheet.startDate')}</label>
                <input id="permit-from" type="date" value={permitSheet.valid_from} onChange={(e) => setPermitSheet({ ...permitSheet, valid_from: e.target.value })} className={input} />
              </div>
              <div>
                <label htmlFor="permit-expiry" className={fieldLabel}>{t('passports.sheet.expires')}</label>
                <input id="permit-expiry" type="date" value={permitSheet.expires_on} onChange={(e) => setPermitSheet({ ...permitSheet, expires_on: e.target.value })} className={input} />
              </div>
            </div>
            <p className="text-caption text-ink-3">{t('passports.sheet.permitHint')}</p>
            {permitError && <p role="alert" className="text-secondary text-red-600">{permitError}</p>}
            <button type="button" onClick={applyPermit} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white">{t('passports.sheet.permitDone')}</button>
            {draftPermits.some((p) => p.key === permitSheet.key) && (
              <button type="button" onClick={removePermit} className="h-11 text-row font-semibold text-red-600">{t('passports.sheet.remove')}</button>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
