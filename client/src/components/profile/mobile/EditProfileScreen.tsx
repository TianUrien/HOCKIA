import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { CountrySelect, DateOfBirthPicker, LocationAutocomplete, PlayingCategorySelector } from '@/components'
import CountryMultiSelect from '@/components/CountryMultiSelect'
import SpecialistSkillsSelect from '@/components/SpecialistSkillsSelect'
import SocialLinksInput from '@/components/SocialLinksInput'
import WorldClubSearch from '@/components/WorldClubSearch'
import { SettingsSwitch } from '@/components/settings/settingsUi'
import { PlayerLeagueField } from './PlayerLeagueField'
import { leagueSideFor } from '@/lib/profileD2'
import { usePlayerLeague } from '@/hooks/usePlayerLeague'
import { SELF_REPORTED_LABEL } from '@/lib/keyFacts'
import type { LocationSelection } from '@/components/LocationAutocomplete'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { optimizeAvatarImage, validateImage } from '@/lib/imageOptimization'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { deleteStorageObject } from '@/lib/storage'
import { invalidateProfile } from '@/lib/profile'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken, roleLabel } from '@/lib/identity'
import { nationalityLine } from '@/lib/nationalityLine'
import { categoryToDisplay, playingCategoryToLegacyGender, type PlayingCategory } from '@/lib/hockeyCategories'
import { pruneSpecialistSkillsForPosition } from '@/lib/specialistSkills'
import { DURATION_LABEL, RELOCATION_LABEL } from '@/lib/candidateIntent'
import { cleanSocialLinks, validateSocialLinks, type SocialLinks } from '@/lib/socialLinks'

/**
 * Edit profile (Figma 101:585): everything the profile shows, as one grouped
 * list. A row opens its own editor and saves just that field — with the same
 * side effects the full form applies (category → legacy gender, position →
 * pruned skills, passports → nationality text, base → city + country). Role
 * is fixed; date of birth locks once declared (the 16+ gate).
 *
 * `field` opens one editor straight away: the Apply sheet's fact rows land
 * here (availability · passports · contact).
 */
export type EditField =
  | 'name' | 'position' | 'category' | 'dob' | 'passports' | 'base' | 'club' | 'skills' | 'about'
  | 'availability' | 'relocation' | 'contact' | 'links'

interface EditProfileScreenProps {
  field?: EditField | null
  onDone: () => void
  /** D2: Passports → the Passports & permits screen (players). */
  onOpenPassports?: () => void
  /** D2: the Availability group → the Open to play screen (players). */
  onOpenToPlay?: () => void
}

const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
const NAME_MAX = 80
const BIO_MAX = 1500
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (iso: string | null | undefined) => { const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null; return m ? `${MONTH[Number(m[2]) - 1]} ${m[1]}` : null }
const longDate = (iso: string | null | undefined) => { const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null; return m ? `${Number(m[3])} ${MONTH[Number(m[2]) - 1]} ${m[1]}` : null }

const input = 'h-[50px] w-full rounded-[12px] bg-surface-grouped px-3.5 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30'
const fieldLabel = 'mb-1.5 block text-secondary font-semibold text-ink-2'

function Row({ label, value, onClick, locked, placeholder = 'Add' }: { label: string; value: string | null; onClick?: () => void; locked?: boolean; placeholder?: string }) {
  const body = (
    <>
      <span className="w-[116px] shrink-0 text-row text-ink-2">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-row ${value ? 'text-ink-1' : 'text-ink-3'}`}>{value ?? placeholder}</span>
      {locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={2} /> : onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} /> : null}
    </>
  )
  const cls = 'flex min-h-[44px] w-full items-center gap-3 py-3 text-left'
  return onClick && !locked ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  )
}

export default function EditProfileScreen({ field = null, onDone, onOpenPassports, onOpenToPlay }: EditProfileScreenProps) {
  const { user, profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const { countries, getCountryById } = useCountries()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [editing, setEditing] = useState<EditField | null>(field)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Draft of the field being edited — reset every time an editor opens.
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const clubCrest = useWorldClubLogo((draft.current_world_club_id as string | null | undefined) ?? profile?.current_world_club_id ?? null)
  const { league } = usePlayerLeague({
    playerId: profile?.role === 'player' ? profile.id : null,
    worldClubId: profile?.current_world_club_id ?? null,
    playingCategory: profile?.playing_category ?? null,
    signedIn: Boolean(user),
  })

  useEffect(() => {
    if (!editing || !profile) return
    setError(null)
    setDraft({
      full_name: profile.full_name ?? '',
      position: profile.position ?? '',
      secondary_position: profile.secondary_position ?? '',
      playing_category: profile.playing_category ?? null,
      date_of_birth: profile.date_of_birth ?? '',
      nationality_country_id: profile.nationality_country_id ?? null,
      nationality2_country_id: profile.nationality2_country_id ?? null,
      base_location: profile.base_location ?? '',
      base_city: profile.base_city ?? '',
      base_country_id: profile.base_country_id ?? null,
      location_selected: Boolean(profile.base_location),
      current_club: profile.current_club ?? '',
      current_world_club_id: profile.current_world_club_id ?? null,
      own_league_id: profile[leagueSideFor(profile.playing_category)] ?? null,
      own_league_name: null,
      club_league_name: null,
      specialist_skills: profile.specialist_skills ?? [],
      bio: profile.bio ?? '',
      available_from: profile.available_from ?? '',
      availability_duration: profile.availability_duration ?? '',
      relocation_willingness: profile.relocation_willingness ?? '',
      relocation_countries_open: profile.relocation_countries_open ?? [],
      contact_email: profile.contact_email ?? '',
      social_links: (profile.social_links ?? {}) as SocialLinks,
    })
  }, [editing, profile])

  if (!profile || !user) return null
  const d = <T,>(key: string) => draft[key] as T
  const set = (patch: Record<string, unknown>) => setDraft((prev) => ({ ...prev, ...patch }))

  const persist = async (patch: Record<string, unknown>) => {
    setSaving(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('profiles').update(patch as never).eq('id', user.id)
      if (updateError) throw updateError
      invalidateProfile({ userId: user.id, reason: 'edit-profile-field' })
      await refreshProfile()
      setEditing(null)
      return true
    } catch (err) {
      logger.error('[EditProfileScreen] save failed', err)
      setError('Could not save that. Please try again.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    switch (editing) {
      case 'name': {
        const name = d<string>('full_name').trim()
        if (!name) return setError('Your name is required.')
        if (name.length > NAME_MAX) return setError(`Keep your name under ${NAME_MAX} characters.`)
        return persist({ full_name: name })
      }
      case 'position': {
        const position = d<string>('position') || null
        const secondary = d<string>('secondary_position') || null
        if (secondary && secondary === position) return setError('Primary and secondary positions must be different.')
        // GK-only skill tags must not survive a move out of goal.
        return persist({ position, secondary_position: secondary, specialist_skills: pruneSpecialistSkillsForPosition(profile.specialist_skills ?? [], position ?? '') })
      }
      case 'category': {
        const category = d<PlayingCategory | null>('playing_category')
        return persist({ playing_category: category, gender: playingCategoryToLegacyGender(category), category_confirmation_needed: false })
      }
      case 'dob': {
        const dob = d<string>('date_of_birth')
        if (!dob) return setError('Choose your date of birth.')
        setSaving(true)
        const { data, error: dobError } = await supabase.rpc('declare_date_of_birth', { p_dob: dob })
        setSaving(false)
        const outcome = (data as { outcome?: string } | null)?.outcome
        if (dobError || outcome === 'invalid_dob') return setError('That date of birth doesn’t look right — please check it.')
        if (outcome === 'already_set') return setError('Your date of birth is locked — contact Hockia support to change it.')
        await refreshProfile()
        return setEditing(null)
      }
      case 'passports': {
        const first = d<number | null>('nationality_country_id')
        let second = d<number | null>('nationality2_country_id')
        if (!first) return setError('Choose your first passport.')
        if (second === first) second = null
        return persist({ nationality_country_id: first, nationality2_country_id: second, nationality: getCountryById(first)?.nationality_name ?? profile.nationality ?? '' })
      }
      case 'base': {
        if (!d<string>('base_location').trim()) return setError('Location is required.')
        return persist({ base_location: d<string>('base_location'), base_city: d<string>('base_city') || null, base_country_id: d<number | null>('base_country_id') || null })
      }
      case 'club': {
        const patch: Record<string, unknown> = { current_club: d<string>('current_club').trim() || null, current_world_club_id: d<string | null>('current_world_club_id') }
        // The player's own league only when their club has none on Hockia
        // (self-reported; never counted for level or fit).
        if (profile.role === 'player' && !d<string | null>('club_league_name')) {
          const side = leagueSideFor(profile.playing_category)
          const ownId = d<number | null>('own_league_id')
          patch[side] = ownId
          if (ownId !== (profile[side] ?? null)) patch[side === 'mens_league_id' ? 'mens_league_division' : 'womens_league_division'] = d<string | null>('own_league_name')
        }
        return persist(patch)
      }
      case 'skills':
        return persist({ specialist_skills: pruneSpecialistSkillsForPosition(d<string[]>('specialist_skills'), profile.position ?? '') })
      case 'about': {
        const bio = d<string>('bio').trim()
        if (bio.length > BIO_MAX) return setError(`Keep it under ${BIO_MAX} characters.`)
        return persist({ bio: bio || null })
      }
      case 'availability':
        return persist({ available_from: d<string>('available_from') || null, availability_duration: d<string>('availability_duration') || null })
      case 'relocation': {
        const willingness = d<string>('relocation_willingness') || null
        return persist({ relocation_willingness: willingness, relocation_countries_open: willingness === 'home_only' ? [] : d<number[]>('relocation_countries_open') })
      }
      case 'contact': {
        const email = d<string>('contact_email').trim()
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('That email doesn’t look right.')
        return persist({ contact_email: email || null })
      }
      case 'links': {
        const links = cleanSocialLinks(d<SocialLinks>('social_links'))
        const check = validateSocialLinks(links)
        if (!check.valid) return setError(check.error ?? 'One of those links doesn’t look right.')
        return persist({ social_links: Object.keys(links).length > 0 ? links : {} })
      }
      default:
        return undefined
    }
  }

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return
    const check = validateImage(file, { maxFileSizeMB: 5 })
    if (!check.valid) { addToast(check.error ?? 'Invalid image', 'error'); return }
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
      // Only once the row points at the new file is the old one safe to drop
      // (deleting first broke avatars — incident 2026-07-30).
      if (previous && previous !== publicUrl) void deleteStorageObject({ bucket: 'avatars', publicUrl: previous, context: 'edit-profile:replace-avatar' })
      invalidateProfile({ userId: user.id, reason: 'edit-profile-avatar' })
      await refreshProfile()
    } catch (err) {
      logger.error('[EditProfileScreen] photo upload failed', err)
      addToast('We couldn’t upload this image. Please use PNG or JPG up to 5MB.', 'error')
    } finally {
      setUploading(false)
    }
  }
  const pickPhoto = async () => {
    if (isNativePlatform()) {
      try { const result = await pickImageNative('prompt'); if (result) await uploadPhoto(result.file) } catch (err) { logger.error('[EditProfileScreen] native picker failed', err); addToast('Could not access camera or photos. Please check app permissions.', 'error') }
      return
    }
    fileRef.current?.click()
  }

  const held = [profile.nationality_country_id, profile.nationality2_country_id].map((id) => (typeof id === 'number' ? countries.find((c) => c.id === id) : undefined)).filter((c): c is NonNullable<typeof c> => Boolean(c))
  const passports = nationalityLine(held, { label: 'demonym' }) ?? (profile.nationality?.trim() || null)
  const positions = [profile.position, profile.secondary_position].filter(Boolean).map((p) => humanizeToken(p)).join(' · ') || null
  const leagueLine = league ? (league.source === 'self_reported' ? `${league.name} · ${SELF_REPORTED_LABEL}` : league.name) : null
  const available = [profile.available_from ? monthYear(profile.available_from) : null, profile.availability_duration ? DURATION_LABEL[profile.availability_duration] ?? null : null].filter(Boolean).join(' · ') || null
  const links = Object.keys((profile.social_links ?? {}) as Record<string, string>).filter((k) => ((profile.social_links ?? {}) as Record<string, string>)[k])
  const name = profile.full_name?.trim() || 'Your profile'
  const dobLocked = Boolean(profile.date_of_birth)
  const p = profile as Profile

  const TITLE: Record<EditField, string> = {
    name: 'Name', position: 'Position', category: 'Category', dob: 'Date of birth', passports: 'Passports', base: 'Base location', club: p.role === 'player' ? 'Club & league' : 'Current club',
    skills: 'Skills', about: 'About', availability: 'Available from', relocation: 'Relocation', contact: 'Contact email', links: 'Social links',
  }

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="edit-profile-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent="Profile" title="Edit profile" onBack={onDone} trailing={<button type="button" onClick={onDone} className="h-11 px-3 text-body font-semibold text-hockia-primary">Done</button>} />
      </div>

      <div className="px-5">
        <div className="flex items-center gap-4 pt-2">
          <EntityAvatar src={p.avatar_url ? getImageUrl(p.avatar_url, 'avatar-lg') ?? p.avatar_url : null} name={name} role={p.role} size={64} />
          <div>
            <p className="text-row font-semibold text-ink-1">Profile photo</p>
            <button type="button" onClick={() => void pickPhoto()} disabled={uploading} className="text-row text-hockia-primary disabled:opacity-60">{uploading ? 'Uploading…' : p.avatar_url ? 'Change photo' : 'Add a photo'}</button>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void uploadPhoto(e.target.files?.[0]); e.target.value = '' }} />
        </div>

        <Group label="Identity">
          <Row label="Name" value={p.full_name?.trim() || null} onClick={() => setEditing('name')} />
          <Row label="Role" value={roleLabel(p.role)} locked />
          <Row label="Position" value={positions} onClick={() => setEditing('position')} />
          <Row label="Category" value={categoryToDisplay(p.playing_category) || null} onClick={() => setEditing('category')} />
          <Row label="Date of birth" value={longDate(p.date_of_birth)} locked={dobLocked} onClick={dobLocked ? undefined : () => setEditing('dob')} />
        </Group>

        <Group label="Passports & base">
          <Row label="Passports" value={passports ? (held.length === 1 ? `${passports} · Add second` : passports) : null} onClick={onOpenPassports ?? (() => setEditing('passports'))} />
          <Row label="Base location" value={p.base_location?.trim() || null} onClick={() => setEditing('base')} />
        </Group>

        <Group label="Hockey">
          <Row label="Current club" value={p.current_club?.trim() || null} onClick={() => setEditing('club')} />
          {p.role === 'player'
            ? <Row label="League" value={leagueLine} locked={league?.source === 'club'} onClick={() => setEditing('club')} />
            : null}
          <Row label="Skills" value={(p.specialist_skills ?? []).map((sk) => humanizeToken(sk)).join(' · ') || null} onClick={() => setEditing('skills')} />
          <Row label="About" value={p.bio?.trim() || null} onClick={() => setEditing('about')} />
        </Group>

        <Group label="Availability">
          {onOpenToPlay ? (
            <>
              {/* D2.4: Open to play is set on its own screen (switch + when + consent). */}
              <Row label="Open to play" value={p.open_to_play ? 'On' : 'Off'} onClick={onOpenToPlay} />
              <Row label="Available from" value={available} onClick={onOpenToPlay} />
            </>
          ) : (
            <>
              <div className="flex min-h-[44px] items-center gap-3 py-2.5">
                <span className="w-[116px] shrink-0 text-row text-ink-2">Open to play</span>
                <span className="min-w-0 flex-1 text-row text-ink-1">{p.open_to_play ? 'On' : 'Off'}</span>
                <SettingsSwitch label="Open to play" checked={Boolean(p.open_to_play)} disabled={saving} onChange={() => void persist({ open_to_play: !p.open_to_play })} />
              </div>
              <Row label="Available from" value={available} onClick={() => setEditing('availability')} />
            </>
          )}
          <Row label="Relocation" value={p.relocation_willingness ? RELOCATION_LABEL[p.relocation_willingness] ?? null : null} onClick={() => setEditing('relocation')} />
        </Group>

        <Group label="Contact & links">
          <Row label="Contact email" value={p.contact_email?.trim() || null} onClick={() => setEditing('contact')} />
          <Row label="Social links" value={links.length ? links.map((k) => humanizeToken(k)).join(' · ') : null} onClick={() => setEditing('links')} />
        </Group>
      </div>

      <BottomSheet open={editing !== null} onClose={() => { if (!saving) setEditing(null) }} ariaLabel={editing ? TITLE[editing] : 'Edit'}>
        {editing && (
          <div className="px-5 pb-3 pt-1">
            <h2 className="text-title text-ink-1">{TITLE[editing]}</h2>
            <div className="mt-3 flex flex-col gap-4">
              {editing === 'name' && <input autoFocus value={d<string>('full_name') ?? ''} maxLength={NAME_MAX} onChange={(e) => set({ full_name: e.target.value })} aria-label="Name" className={input} />}

              {editing === 'position' && (
                <>
                  <div><label htmlFor="edit-position" className={fieldLabel}>Primary</label>
                    <select id="edit-position" value={d<string>('position') ?? ''} onChange={(e) => set({ position: e.target.value })} className={input}>
                      <option value="">Choose a position</option>{POSITIONS.map((o) => <option key={o} value={o}>{humanizeToken(o)}</option>)}
                    </select></div>
                  <div><label htmlFor="edit-position-2" className={fieldLabel}>Secondary (optional)</label>
                    <select id="edit-position-2" value={d<string>('secondary_position') ?? ''} onChange={(e) => set({ secondary_position: e.target.value })} className={input}>
                      <option value="">None</option>{POSITIONS.map((o) => <option key={o} value={o}>{humanizeToken(o)}</option>)}
                    </select></div>
                </>
              )}

              {editing === 'category' && <PlayingCategorySelector value={d<PlayingCategory | null>('playing_category') ?? null} onChange={(next) => set({ playing_category: next })} idPrefix="edit-category" />}

              {editing === 'dob' && (
                <>
                  <DateOfBirthPicker value={d<string>('date_of_birth') ?? ''} onChange={(next) => set({ date_of_birth: next })} />
                  <p className="text-caption text-ink-3">Only used to keep Hockia 16+. It never shows on your profile, and it locks once saved.</p>
                </>
              )}

              {editing === 'passports' && (
                <>
                  <CountrySelect appearance="field" label="First passport" showNationality value={d<number | null>('nationality_country_id') ?? null} onChange={(id) => set({ nationality_country_id: id })} />
                  <CountrySelect appearance="field" label="Second passport (optional)" showNationality value={d<number | null>('nationality2_country_id') ?? null} onChange={(id) => set({ nationality2_country_id: id })} />
                  <p className="text-caption text-ink-3">Clubs filter roles by passport. An EU passport opens EU-only roles.</p>
                </>
              )}

              {editing === 'base' && (
                <LocationAutocomplete
                  label="Where you are based"
                  value={d<string>('base_location') ?? ''}
                  isSelected={Boolean(d<boolean>('location_selected'))}
                  onChange={(value) => set({ base_location: value, location_selected: false })}
                  onLocationSelect={(loc: LocationSelection) => set({ base_location: loc.displayName, base_city: loc.city, base_country_id: loc.countryId, location_selected: true })}
                  onLocationClear={() => set({ base_location: '', base_city: '', base_country_id: null, location_selected: false })}
                />
              )}

              {editing === 'club' && (
                <WorldClubSearch
                  id="edit-club"
                  appearance="field"
                  crestUrl={clubCrest}
                  label="Current club"
                  placeholder="Search your club"
                  value={d<string>('current_club') ?? ''}
                  selectedClubId={d<string | null>('current_world_club_id') ?? null}
                  onChange={(value) => set({ current_club: value })}
                  onClubSelect={(club) => set({ current_club: club.club_name, current_world_club_id: club.id })}
                  onClubClear={() => set({ current_world_club_id: null })}
                />
              )}
              {editing === 'club' && p.role === 'player' && (
                <PlayerLeagueField
                  worldClubId={d<string | null>('current_world_club_id') ?? null}
                  fallbackCountryId={p.base_country_id ?? p.nationality_country_id ?? null}
                  playingCategory={p.playing_category ?? null}
                  value={d<number | null>('own_league_id') ?? null}
                  onChange={(id, name) => set({ own_league_id: id, own_league_name: name })}
                  onClubLeague={(name) => set({ club_league_name: name })}
                />
              )}

              {editing === 'skills' && <SpecialistSkillsSelect value={d<string[]>('specialist_skills') ?? []} onChange={(value) => set({ specialist_skills: value })} position={profile.position} />}

              {editing === 'about' && (
                <>
                  <textarea autoFocus value={d<string>('bio') ?? ''} maxLength={BIO_MAX} rows={7} onChange={(e) => set({ bio: e.target.value })} aria-label="About" className="w-full rounded-[12px] bg-surface-grouped p-3.5 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30" placeholder="A few lines about you and your hockey." />
                  {BIO_MAX - (d<string>('bio') ?? '').length <= 50 && <p className="text-right text-caption text-ink-3">{BIO_MAX - (d<string>('bio') ?? '').length}</p>}
                </>
              )}

              {editing === 'availability' && (
                <>
                  <div><label htmlFor="edit-available-from" className={fieldLabel}>Available from</label>
                    <input id="edit-available-from" type="date" value={d<string>('available_from') ?? ''} onChange={(e) => set({ available_from: e.target.value })} className={input} /></div>
                  <div><label htmlFor="edit-duration" className={fieldLabel}>For how long</label>
                    <select id="edit-duration" value={d<string>('availability_duration') ?? ''} onChange={(e) => set({ availability_duration: e.target.value })} className={input}>
                      <option value="">Not set</option>{Object.entries(DURATION_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                    </select></div>
                </>
              )}

              {editing === 'relocation' && (
                <>
                  <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped" role="radiogroup" aria-label="Relocation">
                    {Object.entries(RELOCATION_LABEL).map(([value, text]) => (
                      <button key={value} type="button" role="radio" aria-checked={d<string>('relocation_willingness') === value} onClick={() => set({ relocation_willingness: value })} className="flex h-[50px] w-full items-center justify-between px-4 text-left text-body text-ink-1">
                        {text}
                        <span className={`h-5 w-5 rounded-full border-2 ${d<string>('relocation_willingness') === value ? 'border-hockia-primary bg-hockia-primary shadow-[inset_0_0_0_3px_white]' : 'border-line'}`} />
                      </button>
                    ))}
                  </div>
                  {d<string>('relocation_willingness') && d<string>('relocation_willingness') !== 'home_only' && (
                    <CountryMultiSelect label="Countries you would move to (optional)" value={d<number[]>('relocation_countries_open') ?? []} onChange={(ids) => set({ relocation_countries_open: ids })} />
                  )}
                </>
              )}

              {editing === 'contact' && (
                <>
                  <input autoFocus type="email" inputMode="email" autoCapitalize="none" value={d<string>('contact_email') ?? ''} onChange={(e) => set({ contact_email: e.target.value })} placeholder="name@email.com" aria-label="Contact email" className={input} />
                  <p className="text-caption text-ink-3">Clubs see it once they reply to your application. Settings › Privacy decides whether it also shows on your profile.</p>
                </>
              )}

              {editing === 'links' && <SocialLinksInput value={d<SocialLinks>('social_links') ?? {}} onChange={(value) => set({ social_links: value })} />}

              {error && <p role="alert" className="text-secondary text-red-600">{error}</p>}
              <button type="button" onClick={() => void save()} disabled={saving} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
