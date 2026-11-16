import { useRef, useState } from 'react'
import { Camera, ChevronRight, MapPin, Plus, Trash2, Trophy, X } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { Chip } from '@/components/ui/Chip'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { fieldInput, fieldInputBase, fieldLabel, fieldSelect } from '@/components/ui/fieldClasses'
import WorldClubSearch, { type WorldClubSearchResult } from '@/components/WorldClubSearch'
import CountrySelect from '@/components/CountrySelect'
import ConfirmActionModal from '@/components/ConfirmActionModal'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { optimizeImage, validateImage, imageFileExtension } from '@/lib/imageOptimization'
import { deleteStorageObject, extractStoragePath } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { SignedThroughHockiaPill } from '@/components/profile/SignedThroughHockiaPill'
import type { CareerHistoryRow } from '@/hooks/useCareerTimeline'
import { switchTrackClass } from '@/components/ui/switchClasses'
import { useProfileEditT } from '@/i18n/ns/profileEdit'

/**
 * Career entry (Figma 145:671) — one entry, every career_history field:
 *   type chips → entry_type · Club picker → world_club_id (claimed) or plain
 *   club_name · Role → position_role · Team → description · League →
 *   division_league · Where → location_city + location_country · From/To →
 *   start_date / end_date ("I'm still here" = end_date NULL and keeps this as
 *   the current club) · Highlights → highlights[] · Photo → image_url.
 * National team swaps Club for represented_country_id / level / caps.
 * Scrolls under a fixed Save; Delete is last and small.
 */
type EntryType = CareerHistoryRow['entry_type']
type TypeLabelKey = 'club' | 'nationalTeam' | 'tournament' | 'achievement' | 'milestone' | 'academy' | 'other'
// Labels are catalog keys (careerEntry.type.*), translated where rendered.
const TYPE_CHIPS: { value: EntryType; labelKey: TypeLabelKey }[] = [
  { value: 'club', labelKey: 'club' },
  { value: 'national_team', labelKey: 'nationalTeam' },
  { value: 'tournament', labelKey: 'tournament' },
  { value: 'achievement', labelKey: 'achievement' },
]
const LEGACY_LABEL: Record<string, TypeLabelKey> = { milestone: 'milestone', academy: 'academy', other: 'other' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const BUCKET = 'journey'

const toMonth = (iso: string | null) => (iso ? iso.slice(0, 7) : '')
const fromMonth = (month: string) => (month ? `${month}-01` : null)
const monthLabel = (iso: string | null) => {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null
}

interface CareerEntryScreenProps {
  entry: CareerHistoryRow | null
  /** Crest of the entry's linked club, for the picker's left slot. */
  initialCrestUrl?: string | null
  nextDisplayOrder: number
  onClose: (changed: boolean) => void
}

// Text field (Figma 472:243) — `ui/fieldClasses`.
const field = fieldInput

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className={fieldLabel}>{children}</label>
}

export default function CareerEntryScreen({ entry, initialCrestUrl = null, nextDisplayOrder, onClose }: CareerEntryScreenProps) {
  const t = useProfileEditT()
  const { user, profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [type, setType] = useState<EntryType>(entry?.entry_type ?? 'club')
  const [clubName, setClubName] = useState(entry?.club_name ?? '')
  const [worldClubId, setWorldClubId] = useState<string | null>(entry?.world_club_id ?? null)
  const [crestUrl, setCrestUrl] = useState<string | null>(initialCrestUrl)
  const [role, setRole] = useState(entry?.position_role ?? '')
  const [team, setTeam] = useState(entry?.description ?? '')
  const [league, setLeague] = useState(entry?.division_league ?? '')
  const [where, setWhere] = useState([entry?.location_city, entry?.location_country].map((v) => v?.trim()).filter(Boolean).join(', '))
  const [from, setFrom] = useState(toMonth(entry?.start_date ?? null))
  const [to, setTo] = useState(toMonth(entry?.end_date ?? null))
  const [stillHere, setStillHere] = useState(entry ? Boolean(entry.start_date) && !entry.end_date : false)
  const [highlights, setHighlights] = useState<string[]>(Array.isArray(entry?.highlights) ? entry!.highlights.filter(Boolean) : [])
  const [draftHighlight, setDraftHighlight] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(entry?.image_url ?? null)
  const [countryId, setCountryId] = useState<number | null>(entry?.represented_country_id ?? null)
  const [level, setLevel] = useState(entry?.represented_level ?? '')
  const [caps, setCaps] = useState(entry?.caps != null ? String(entry.caps) : '')
  const [errors, setErrors] = useState<{ name?: string; from?: string; to?: string }>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isClub = type === 'club'
  const isNational = type === 'national_team'
  const chips = entry && LEGACY_LABEL[entry.entry_type] ? [...TYPE_CHIPS, { value: entry.entry_type, labelKey: LEGACY_LABEL[entry.entry_type] }] : TYPE_CHIPS

  const addHighlight = () => {
    const value = draftHighlight.trim()
    if (!value) return
    setHighlights((h) => [...h, value])
    setDraftHighlight('')
  }

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !user) return
    const check = validateImage(file, { maxFileSizeMB: 5 })
    if (!check.valid) { addToast(check.error ?? t('careerEntry.toast.invalidImage'), 'error'); return }
    setUploading(true)
    try {
      const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const optimized = await optimizeImage(file, { maxWidth: 800, maxHeight: 800, maxSizeMB: 1, mimeType })
      const ext = imageFileExtension(optimized)
      const path = `${user.id}/journey/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, optimized, { upsert: true, cacheControl: '31536000' })
      if (error) throw error
      setImageUrl(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    } catch (err) {
      logger.error('[CareerEntryScreen] photo upload failed', err)
      addToast(t('careerEntry.toast.uploadFailed'), 'error')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!user) return
    const next: typeof errors = {}
    if (!clubName.trim()) next.name = isClub ? t('careerEntry.error.chooseClub') : t('careerEntry.error.giveTitle')
    if (!from) next.from = t('careerEntry.error.addStart')
    if (!stillHere && to && from && to < from) next.to = t('careerEntry.error.endsBeforeStart')
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const startDate = fromMonth(from)
    const endDate = stillHere ? null : fromMonth(to)
    const comma = where.lastIndexOf(',')
    const city = (comma === -1 ? where : where.slice(0, comma)).trim()
    const country = comma === -1 ? '' : where.slice(comma + 1).trim()
    const capsNumber = Number(caps)
    const payload = {
      user_id: user.id,
      entry_type: type,
      club_name: clubName.trim(),
      world_club_id: isClub ? worldClubId : null,
      position_role: role.trim(),
      description: team.trim(),
      division_league: league.trim(),
      location_city: city,
      location_country: country,
      start_date: startDate,
      end_date: endDate,
      years: `${monthLabel(startDate) ?? ''} - ${endDate ? monthLabel(endDate) ?? '' : 'Present'}`,
      highlights: highlights.map((h) => h.trim()).filter(Boolean),
      image_url: imageUrl,
      represented_country_id: isNational ? countryId : null,
      represented_level: isNational ? level || null : null,
      caps: isNational && caps.trim() && Number.isFinite(capsNumber) && capsNumber >= 0 ? capsNumber : null,
      display_order: entry?.display_order ?? nextDisplayOrder,
    }

    setSaving(true)
    try {
      const { error } = entry
        ? await supabase.from('career_history').update(payload).eq('id', entry.id)
        : await supabase.from('career_history').insert(payload)
      if (error) throw error

      // "I'm still here" keeps this as the current club (Figma copy + DEV NOTE).
      if (isClub && stillHere && (profile?.current_club !== payload.club_name || (profile?.current_world_club_id ?? null) !== worldClubId)) {
        const { error: clubError } = await supabase
          .from('profiles')
          .update({ current_club: payload.club_name, current_world_club_id: worldClubId })
          .eq('id', user.id)
        if (clubError) logger.error('[CareerEntryScreen] current club update failed', clubError)
        else await refreshProfile()
      }

      // The row now points at the new photo — the replaced one can go.
      if (entry?.image_url && entry.image_url !== imageUrl) {
        const old = extractStoragePath(entry.image_url, BUCKET)
        if (old) void deleteStorageObject({ bucket: BUCKET, path: old, context: 'career-entry:replace-photo' })
      }
      addToast(t('careerEntry.toast.saved'), 'success')
      onClose(true)
    } catch (err) {
      logger.error('[CareerEntryScreen] save failed', err)
      addToast(t('careerEntry.toast.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!entry) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('career_history').delete().eq('id', entry.id)
      if (error) throw error
      const path = entry.image_url ? extractStoragePath(entry.image_url, BUCKET) : null
      if (path) void deleteStorageObject({ bucket: BUCKET, path, context: 'career-entry:delete' })
      addToast(t('careerEntry.toast.removed'), 'success')
      onClose(true)
    } catch (err) {
      logger.error('[CareerEntryScreen] delete failed', err)
      addToast(t('careerEntry.toast.deleteFailed'), 'error')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="min-h-screen bg-white pb-44 lg:hidden" data-testid="career-entry-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent={t('careerEntry.nav.parent')} title={entry ? t('careerEntry.nav.edit') : t('careerEntry.nav.new')} onBack={() => onClose(false)} />
        {entry?.signed_via_hockia && (
          // D4: the signing itself created this entry; club and season stay as signed (server trigger).
          <div className="flex items-center gap-2 px-5 pb-2">
            <SignedThroughHockiaPill />
            <span className="text-caption text-ink-3">{t('careerEntry.nav.signedNote')}</span>
          </div>
        )}
        <div className="flex gap-2 overflow-x-auto px-5 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label={t('careerEntry.type.groupLabel')}>
          {chips.map((c) => (
            <Chip key={c.value} label={t(`careerEntry.type.${c.labelKey}`)} selected={type === c.value} onClick={() => setType(c.value)} role="radio" aria-checked={type === c.value} aria-pressed={undefined} data-testid="career-entry-type" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-5 px-5 pt-1">
        {isClub ? (
          <div>
            <WorldClubSearch
              id="career-entry-club"
              appearance="field"
              crestUrl={crestUrl}
              label={t('careerEntry.field.club')}
              value={clubName}
              onChange={setClubName}
              selectedClubId={worldClubId}
              error={errors.name}
              placeholder={t('careerEntry.field.clubPlaceholder')}
              onClubClear={() => { setWorldClubId(null); setCrestUrl(null) }}
              onClubSelect={(club: WorldClubSearchResult) => {
                setClubName(club.club_name)
                setWorldClubId(club.id)
                setCrestUrl(club.avatar_url)
                const clubLeague = club.men_league_name || club.women_league_name
                if (clubLeague && !league.trim()) setLeague(clubLeague)
                if (club.country_name && !where.trim()) setWhere(club.country_name)
              }}
            />
            {/* The picker carries its own tip while nothing is linked. */}
            {worldClubId && <p className="mt-1.5 text-caption text-ink-3">{t('careerEntry.field.claimedHint')}</p>}
          </div>
        ) : (
          <div>
            <Label htmlFor="career-entry-title">{isNational ? t('careerEntry.field.team') : t('careerEntry.field.title')}</Label>
            <input id="career-entry-title" value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder={isNational ? t('careerEntry.field.nationalPlaceholder') : t('careerEntry.field.titlePlaceholder')} className={field} />
            {errors.name && <p className="mt-1 text-caption text-red-600">{errors.name}</p>}
          </div>
        )}

        {isNational && (
          <>
            <CountrySelect appearance="field" label={t('careerEntry.field.countryRepresented')} value={countryId} onChange={setCountryId} placeholder={t('careerEntry.field.countryPlaceholder')} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="career-entry-level">{t('careerEntry.field.level')}</Label>
                <select id="career-entry-level" value={level} onChange={(e) => setLevel(e.target.value)} className={fieldSelect}>
                  <option value="">{t('careerEntry.level.notSpecified')}</option>
                  <option value="senior">{t('careerEntry.level.senior')}</option>
                  <option value="junior">{t('careerEntry.level.junior')}</option>
                  <option value="masters">{t('careerEntry.level.masters')}</option>
                </select>
              </div>
              <div>
                <Label htmlFor="career-entry-caps">{t('careerEntry.field.caps')}</Label>
                <input id="career-entry-caps" inputMode="numeric" value={caps} onChange={(e) => setCaps(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('careerEntry.field.capsPlaceholder')} className={field} />
              </div>
            </div>
          </>
        )}

        <div>
          <Label htmlFor="career-entry-role">{t('careerEntry.field.role')}</Label>
          <input id="career-entry-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('careerEntry.field.rolePlaceholder')} className={field} />
        </div>

        <div>
          <Label htmlFor="career-entry-team">{t('careerEntry.field.team')}</Label>
          <input id="career-entry-team" value={team} onChange={(e) => setTeam(e.target.value)} placeholder={t('careerEntry.field.teamPlaceholder')} className={field} />
        </div>

        {!isNational && (
          <div>
            <Label htmlFor="career-entry-league">{t('careerEntry.field.league')}</Label>
            <div className="relative">
              <Trophy className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" strokeWidth={1.8} />
              <input id="career-entry-league" value={league} onChange={(e) => setLeague(e.target.value)} placeholder={t('careerEntry.field.leaguePlaceholder')} className={`${fieldInputBase} pl-11 pr-3.5`} />
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="career-entry-where">{t('careerEntry.field.where')}</Label>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" strokeWidth={1.8} />
            <input id="career-entry-where" value={where} onChange={(e) => setWhere(e.target.value)} placeholder={t('careerEntry.field.wherePlaceholder')} className={`${fieldInputBase} pl-11 pr-3.5`} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="career-entry-from">{t('careerEntry.field.from')}</Label>
            <input id="career-entry-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
            {errors.from && <p className="mt-1 text-caption text-red-600">{errors.from}</p>}
          </div>
          <div>
            <Label htmlFor="career-entry-to">{t('careerEntry.field.to')}</Label>
            {stillHere ? (
              <div className="flex h-[50px] w-full items-center rounded-[12px] bg-surface-muted px-3.5 text-[16px] leading-[22px] text-ink-2">{t('careerEntry.field.present')}</div>
            ) : (
              <input id="career-entry-to" type="month" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} />
            )}
            {errors.to && <p className="mt-1 text-caption text-red-600">{errors.to}</p>}
          </div>
        </div>

        <button type="button" role="switch" aria-checked={stillHere} onClick={() => setStillHere((v) => !v)} className="flex items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-row font-semibold text-ink-1">{t('careerEntry.field.stillHere')}</span>
            <span className="block text-caption text-ink-3">{isClub ? t('careerEntry.field.stillHereClub') : t('careerEntry.field.stillHereOther')}</span>
          </span>
          <span className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', switchTrackClass(stillHere))}>
            <span className={cn('absolute top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow transition-all', stillHere ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>

        <div>
          <Label>{t('careerEntry.field.highlights')}</Label>
          <ul className="flex flex-col gap-2">
            {highlights.map((h, i) => (
              <li key={`${h}-${i}`} className="flex h-[50px] w-full items-center gap-2 rounded-[12px] bg-surface-muted px-3.5 text-[16px] leading-[22px] text-ink-1">
                <span className="min-w-0 flex-1 truncate">{h}</span>
                <button type="button" onClick={() => setHighlights((list) => list.filter((_, j) => j !== i))} aria-label={t('careerEntry.field.removeHighlight', { highlight: h })} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-ink-3"><X className="h-4 w-4" /></button>
              </li>
            ))}
            <li className="flex h-[50px] w-full items-center gap-2 rounded-[12px] bg-surface-muted px-3.5 focus-within:bg-white focus-within:ring-1 focus-within:ring-inset focus-within:ring-hockia-primary">
              <Plus className="h-[18px] w-[18px] shrink-0 text-hockia-primary" strokeWidth={2.2} />
              <input
                value={draftHighlight}
                onChange={(e) => setDraftHighlight(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHighlight() } }}
                onBlur={addHighlight}
                placeholder={t('careerEntry.field.addHighlight')}
                aria-label={t('careerEntry.field.addHighlight')}
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] leading-[22px] text-ink-1 placeholder:text-hockia-primary focus:outline-none"
              />
            </li>
          </ul>
          <p className="mt-1.5 text-caption text-ink-3">{t('careerEntry.field.highlightsHint')}</p>
        </div>

        <div>
          <Label>{t('careerEntry.photo.label')}</Label>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
          <div className="flex items-center gap-3 rounded-card bg-surface-grouped p-3">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white text-ink-3 disabled:opacity-60" aria-label={imageUrl ? t('careerEntry.photo.replace') : t('careerEntry.photo.add')}>
              {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : <Camera className="h-5 w-5" strokeWidth={1.8} />}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="min-w-0 flex-1 text-left">
              <span className="block text-row font-semibold text-ink-1">{uploading ? t('careerEntry.photo.uploading') : imageUrl ? t('careerEntry.photo.replace') : t('careerEntry.photo.add')}</span>
              <span className="block text-caption text-ink-3">{t('careerEntry.photo.hint')}</span>
            </button>
            {imageUrl ? (
              <button type="button" onClick={() => setImageUrl(null)} aria-label={t('careerEntry.photo.remove')} className="flex h-9 w-9 items-center justify-center text-ink-3"><X className="h-4 w-4" /></button>
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" />
            )}
          </div>
        </div>

        {entry && (
          <button type="button" onClick={() => setConfirmDelete(true)} className="mx-auto mt-2 flex items-center gap-1.5 py-2 text-row font-semibold text-red-600">
            <Trash2 className="h-4 w-4" strokeWidth={2} /> {t('careerEntry.delete.button')}
          </button>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-white px-5 pb-3 pt-3 lg:hidden">
        <button type="button" onClick={() => void save()} disabled={saving || uploading} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })} data-testid="career-entry-save">
          {saving ? t('careerEntry.field.saving') : t('careerEntry.field.save')}
        </button>
      </div>

      <ConfirmActionModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        title={t('careerEntry.delete.title')}
        description={t('careerEntry.delete.body')}
        confirmLabel={t('careerEntry.delete.confirm')}
        confirmTone="danger"
        confirmLoading={deleting}
        loadingLabel={t('careerEntry.delete.loading')}
      />
    </div>
  )
}
