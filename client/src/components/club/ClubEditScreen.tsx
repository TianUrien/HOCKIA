import { useEffect, useRef, useState, type ReactNode } from 'react'
import { rememberCrestColor } from '@/hooks/useClubCrestColors'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Lock } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { CountrySelect, LocationAutocomplete } from '@/components'
import SocialLinksInput from '@/components/SocialLinksInput'
import { ContactEmailPublicRow, SheetActions } from '@/components/settings/settingsUi'
import { contactEmailIntro } from '@/lib/clubSettingsCopy'
import { useClubT } from '@/i18n/ns/club'
import type { LocationSelection } from '@/components/LocationAutocomplete'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { optimizeAvatarImage, validateImage } from '@/lib/imageOptimization'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { deleteStorageObject } from '@/lib/storage'
import { invalidateProfile } from '@/lib/profile'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken } from '@/lib/identity'
import { cleanSocialLinks, validateSocialLinks, type SocialLinks } from '@/lib/socialLinks'
import {
  CLUB_BIO_MAX, CLUB_NAME_MAX, clubLeagueRowValue, contactRowValue, foundedYears, isValidWebsite,
  photosRowValue, websiteLabel, yearFoundedError,
} from '@/lib/clubEdit'
import { countryLabel, placeText } from '@/i18n/countryNames'

/**
 * Edit club profile (Figma 04 Club D1.27, DEV NOTE 368:1103): Edit profile in
 * club mode. Player-only fields go; club fields come in. Each row opens its
 * own sheet and saves just that field, with the same columns and rules as the
 * v1 club editor. Type is fixed. Club & league opens its own screen (338:424);
 * Photos opens the club's Manage media. Empty values read "Add" in brand colour.
 * Back ("Profile") and Done return to the club profile.
 */
type Field = 'name' | 'year' | 'country' | 'city' | 'about' | 'website' | 'links' | 'contact'

const TITLE_KEY = {
  name: 'clubEdit.fields.name', year: 'clubEdit.fields.year', country: 'clubEdit.fields.country', city: 'clubEdit.fields.city', about: 'clubEdit.fields.about',
  website: 'clubEdit.fields.website', links: 'clubEdit.fields.links', contact: 'clubEdit.fields.contact',
} as const satisfies Record<Field, string>

const input = 'h-[50px] w-full rounded-[12px] bg-surface-grouped px-3.5 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30'

function Row({ label, value, onClick, locked, placeholder, multiline }: {
  label: string
  value: string | null
  onClick?: () => void
  locked?: boolean
  placeholder?: string
  multiline?: boolean
}) {
  const t = useClubT()
  const body = (
    <>
      <span className="w-[120px] shrink-0 text-row text-ink-2">{label}</span>
      <span className={`min-w-0 flex-1 text-row ${multiline ? 'line-clamp-2' : 'truncate'} ${value ? 'text-ink-1' : 'text-hockia-primary'}`}>{value ?? placeholder ?? t('clubEdit.add')}</span>
      {locked ? <Lock className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} aria-label={t('clubEdit.locked')} /> : <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />}
    </>
  )
  const cls = 'flex min-h-[44px] w-full items-center gap-3 py-3 text-left'
  return onClick && !locked ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-[18px]">
      <h2 className="pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  )
}

export default function ClubEditScreen() {
  const t = useClubT()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromSettings = searchParams.get('from') === 'settings'
  const { user, profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const { getCountryById } = useCountries()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [editing, setEditing] = useState<Field | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [photoCount, setPhotoCount] = useState<number | null>(null)
  const profileId = profile?.id ?? null

  // Photos row: the club's media count (club_media is public-read, like the profile cover).
  useEffect(() => {
    if (!profileId) return
    let cancelled = false
    void supabase.from('club_media').select('id', { count: 'exact', head: true }).eq('club_id', profileId).then(({ count, error: countError }) => {
      if (cancelled) return
      if (countError) logger.debug('[ClubEditScreen] media count failed', countError)
      setPhotoCount(countError ? null : count ?? 0)
    })
    return () => { cancelled = true }
  }, [profileId])

  useEffect(() => {
    if (!editing || !profile) return
    setError(null)
    setDraft({
      full_name: profile.full_name ?? '',
      year_founded: profile.year_founded ? String(profile.year_founded) : '',
      nationality_country_id: profile.nationality_country_id ?? null,
      base_location: profile.base_location ?? '',
      base_city: profile.base_city ?? '',
      base_country_id: profile.base_country_id ?? null,
      location_selected: Boolean(profile.base_location),
      club_bio: profile.club_bio ?? '',
      website: profile.website ?? '',
      social_links: (profile.social_links ?? {}) as SocialLinks,
      contact_email: profile.contact_email ?? '',
      contact_email_public: Boolean(profile.contact_email_public),
    })
  }, [editing, profile])

  if (!profile || !user) return null
  const d = <T,>(key: string) => draft[key] as T
  const set = (patch: Record<string, unknown>) => setDraft((prev) => ({ ...prev, ...patch }))
  // Opened from Settings (?from=settings): back names and returns there.
  const toParent = () => navigate(fromSettings ? '/settings' : '/dashboard/profile')
  const via = fromSettings ? '&via=settings' : ''

  const persist = async (patch: Record<string, unknown>) => {
    setSaving(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('profiles').update(patch as never).eq('id', user.id)
      if (updateError) throw updateError
      invalidateProfile({ userId: user.id, reason: 'edit-club-field' })
      await refreshProfile()
      setEditing(null)
    } catch (err) {
      logger.error('[ClubEditScreen] save failed', err)
      setError(t('clubEdit.errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    switch (editing) {
      case 'name': {
        const name = d<string>('full_name').trim()
        if (!name) return setError(t('clubEdit.errors.nameRequired'))
        if (name.length > CLUB_NAME_MAX) return setError(t('clubEdit.errors.nameTooLong', { max: CLUB_NAME_MAX }))
        return persist({ full_name: name })
      }
      case 'year': {
        const year = d<string>('year_founded')
        const yearError = yearFoundedError(year)
        if (yearError) return setError(yearError)
        return persist({ year_founded: year ? Number(year) : null })
      }
      case 'country': {
        // v1 club editor: the club's country lives in nationality_country_id
        // (the flag on the profile) with its text twin.
        const id = d<number | null>('nationality_country_id')
        if (!id) return setError(t('clubEdit.errors.countryRequired'))
        return persist({ nationality_country_id: id, nationality: getCountryById(id)?.nationality_name ?? profile.nationality ?? '' })
      }
      case 'city': {
        if (!d<string>('base_location').trim()) return setError(t('clubEdit.errors.cityRequired'))
        return persist({ base_location: d<string>('base_location'), base_city: d<string>('base_city') || null, base_country_id: d<number | null>('base_country_id') || null })
      }
      case 'about': {
        const bio = d<string>('club_bio').trim()
        if (bio.length > CLUB_BIO_MAX) return setError(t('clubEdit.errors.aboutTooLong', { max: CLUB_BIO_MAX }))
        return persist({ club_bio: bio || null })
      }
      case 'website': {
        const site = d<string>('website').trim()
        if (!isValidWebsite(site)) return setError(t('clubEdit.errors.websiteInvalid'))
        return persist({ website: site || null })
      }
      case 'links': {
        const links = cleanSocialLinks(d<SocialLinks>('social_links'))
        const check = validateSocialLinks(links)
        if (!check.valid) return setError(check.error ?? t('clubEdit.errors.linksInvalid'))
        return persist({ social_links: Object.keys(links).length > 0 ? links : {} })
      }
      case 'contact': {
        const email = d<string>('contact_email').trim()
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError(t('clubEdit.errors.emailInvalid'))
        return persist({ contact_email: email || null, contact_email_public: email ? Boolean(d<boolean>('contact_email_public')) : false })
      }
      default:
        return undefined
    }
  }

  const uploadCrest = async (file: File | undefined) => {
    if (!file) return
    const check = validateImage(file, { maxFileSizeMB: 5 })
    if (!check.valid) { addToast(check.error ?? t('clubEdit.crest.invalidImage'), 'error'); return }
    setUploading(true)
    try {
      const optimized = await optimizeAvatarImage(file)
      const ext = optimized.name.split('.').pop() || 'jpg'
      const path = `${user.id}/avatar_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, optimized, { upsert: true, cacheControl: '31536000' })
      if (uploadError) throw uploadError
      const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      const previous = profile.avatar_url
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id)
      if (updateError) throw updateError
      // Community club card colour (Cover=Crest), from the crest just uploaded.
      rememberCrestColor(user.id, publicUrl, optimized)
      // Drop the old file only once the row points at the new one (incident 2026-07-30).
      if (previous && previous !== publicUrl) void deleteStorageObject({ bucket: 'avatars', publicUrl: previous, context: 'edit-club:replace-crest' })
      invalidateProfile({ userId: user.id, reason: 'edit-club-crest' })
      await refreshProfile()
    } catch (err) {
      logger.error('[ClubEditScreen] crest upload failed', err)
      addToast(t('clubEdit.crest.uploadFailed'), 'error')
    } finally {
      setUploading(false)
    }
  }
  const pickCrest = async () => {
    if (isNativePlatform()) {
      try { const result = await pickImageNative('prompt'); if (result) await uploadCrest(result.file) } catch (err) { logger.error('[ClubEditScreen] native picker failed', err); addToast(t('clubEdit.crest.pickerFailed'), 'error') }
      return
    }
    fileRef.current?.click()
  }

  const country = typeof profile.nationality_country_id === 'number' ? getCountryById(profile.nationality_country_id) : undefined
  const countryValue = country ? [country.flag_emoji, countryLabel(country.common_name || country.name)].filter(Boolean).join(' ') : null
  const links = Object.entries((profile.social_links ?? {}) as Record<string, string>).filter(([, v]) => Boolean(v)).map(([k]) => humanizeToken(k))
  const name = profile.full_name?.trim() || t('clubEdit.fallbackName')
  const bioLeft = CLUB_BIO_MAX - (d<string>('club_bio') ?? '').length

  return (
    <div className="min-h-screen bg-white pb-12 lg:hidden" data-testid="club-edit-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent={fromSettings ? t('clubEdit.nav.settings') : t('clubEdit.nav.profile')} title={t('clubEdit.nav.title')} showParent onBack={toParent} trailing={<button type="button" onClick={toParent} className="h-11 px-3 text-body font-semibold text-hockia-primary">{t('clubEdit.nav.done')}</button>} />
      </div>

      <div className="px-5">
        <div className="flex items-center gap-3.5 py-4">
          <EntityAvatar src={profile.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-lg') ?? profile.avatar_url : null} name={name} role="club" size={64} />
          <div>
            <p className="text-row font-semibold text-ink-1">{t('clubEdit.crest.label')}</p>
            <button type="button" onClick={() => void pickCrest()} disabled={uploading} className="text-row text-hockia-primary disabled:opacity-60">{uploading ? t('clubEdit.crest.uploading') : profile.avatar_url ? t('clubEdit.crest.change') : t('clubEdit.crest.add')}</button>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" data-testid="club-crest-input" onChange={(e) => { void uploadCrest(e.target.files?.[0]); e.target.value = '' }} />
        </div>

        <Group label={t('clubEdit.groups.identity')}>
          <Row label={t('clubEdit.rows.name')} value={profile.full_name?.trim() || null} onClick={() => setEditing('name')} />
          <Row label={t('clubEdit.rows.type')} value={t('clubEdit.rows.typeClub')} locked />
          <Row label={t('clubEdit.rows.year')} value={profile.year_founded ? String(profile.year_founded) : null} onClick={() => setEditing('year')} />
        </Group>

        <Group label={t('clubEdit.groups.location')}>
          <Row label={t('clubEdit.rows.country')} value={countryValue} onClick={() => setEditing('country')} />
          <Row label={t('clubEdit.rows.city')} value={profile.base_city?.trim() || placeText(profile.base_location?.trim()) || null} onClick={() => setEditing('city')} />
        </Group>

        <Group label={t('clubEdit.groups.hockey')}>
          <Row
            label={t('clubEdit.rows.clubLeague')}
            value={clubLeagueRowValue(Boolean(profile.current_world_club_id), profile.mens_league_division, profile.womens_league_division)}
            placeholder={t('clubEdit.rows.linkClub')}
            multiline
            onClick={() => navigate(`/dashboard/profile/league?from=edit${via}`)}
          />
        </Group>

        <Group label={t('clubEdit.groups.about')}>
          <Row label={t('clubEdit.rows.about')} value={profile.club_bio?.trim() || null} multiline onClick={() => setEditing('about')} />
          <Row label={t('clubEdit.rows.photos')} value={photosRowValue(photoCount)} onClick={() => navigate(`/dashboard/profile/media?from=edit${via}`)} />
        </Group>

        <Group label={t('clubEdit.groups.contact')}>
          <Row label={t('clubEdit.rows.website')} value={websiteLabel(profile.website)} onClick={() => setEditing('website')} />
          <Row label={t('clubEdit.rows.links')} value={links.length ? links.join(' · ') : null} onClick={() => setEditing('links')} />
          <Row label={t('clubEdit.rows.contact')} value={contactRowValue(profile.contact_email, profile.contact_email_public)} onClick={() => setEditing('contact')} />
        </Group>
      </div>

      <BottomSheet open={editing !== null} onClose={() => { if (!saving) setEditing(null) }} ariaLabel={editing ? t(TITLE_KEY[editing]) : t('clubEdit.sheetFallback')}>
        {editing && (
          <div className="px-5 pb-3 pt-1">
            <h2 className="text-title text-ink-1">{t(TITLE_KEY[editing])}</h2>
            <div className="mt-3 flex flex-col gap-4">
              {editing === 'name' && <input autoFocus value={d<string>('full_name') ?? ''} maxLength={CLUB_NAME_MAX} onChange={(e) => set({ full_name: e.target.value })} aria-label={t('clubEdit.inputs.name')} className={input} />}

              {editing === 'year' && (
                <select value={d<string>('year_founded') ?? ''} onChange={(e) => set({ year_founded: e.target.value })} aria-label={t('clubEdit.inputs.year')} className={input}>
                  <option value="">{t('clubEdit.inputs.yearNotSet')}</option>
                  {foundedYears().map((y) => <option key={y} value={String(y)}>{y}</option>)}
                </select>
              )}

              {editing === 'country' && <CountrySelect appearance="field" label={t('clubEdit.inputs.country')} value={d<number | null>('nationality_country_id') ?? null} onChange={(id) => set({ nationality_country_id: id })} />}

              {editing === 'city' && (
                <LocationAutocomplete
                  label={t('clubEdit.inputs.city')}
                  value={d<string>('base_location') ?? ''}
                  isSelected={Boolean(d<boolean>('location_selected'))}
                  onChange={(value) => set({ base_location: value, location_selected: false })}
                  onLocationSelect={(loc: LocationSelection) => set({ base_location: loc.displayName, base_city: loc.city, base_country_id: loc.countryId, location_selected: true })}
                  onLocationClear={() => set({ base_location: '', base_city: '', base_country_id: null, location_selected: false })}
                />
              )}

              {editing === 'about' && (
                <>
                  <textarea autoFocus value={d<string>('club_bio') ?? ''} maxLength={CLUB_BIO_MAX} rows={7} onChange={(e) => set({ club_bio: e.target.value })} aria-label={t('clubEdit.inputs.about')} className="w-full rounded-[12px] bg-surface-grouped p-3.5 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30" placeholder={t('clubEdit.inputs.aboutPlaceholder')} />
                  {bioLeft <= 50 && <p className="text-right text-caption text-ink-3">{bioLeft}</p>}
                </>
              )}

              {editing === 'website' && <input autoFocus type="url" inputMode="url" autoCapitalize="none" value={d<string>('website') ?? ''} onChange={(e) => set({ website: e.target.value })} placeholder={t('clubEdit.inputs.websitePlaceholder')} aria-label={t('clubEdit.inputs.website')} className={input} />}

              {editing === 'links' && <SocialLinksInput value={d<SocialLinks>('social_links') ?? {}} onChange={(value) => set({ social_links: value })} />}

              {editing === 'contact' && (
                <>
                  <p className="text-secondary text-ink-2">{contactEmailIntro()}</p>
                  <input autoFocus type="email" inputMode="email" autoCapitalize="none" value={d<string>('contact_email') ?? ''} onChange={(e) => set({ contact_email: e.target.value })} placeholder={t('clubEdit.inputs.contactPlaceholder')} aria-label={t('clubEdit.inputs.contact')} className={input} />
                  <ContactEmailPublicRow
                    checked={Boolean(d<boolean>('contact_email_public')) && (d<string>('contact_email') ?? '').trim() !== ''}
                    disabled={(d<string>('contact_email') ?? '').trim() === ''}
                    onChange={() => set({ contact_email_public: !d<boolean>('contact_email_public') })}
                  />
                </>
              )}

              {error && <p role="alert" className="text-secondary text-status-danger">{error}</p>}
              <SheetActions onCancel={() => setEditing(null)} onSave={() => void save()} saving={saving} />
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
