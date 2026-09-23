import { useRef, useState } from 'react'
import { Camera, ChevronRight, MapPin, Plus, Trash2, Trophy, X } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import WorldClubSearch, { type WorldClubSearchResult } from '@/components/WorldClubSearch'
import CountrySelect from '@/components/CountrySelect'
import ConfirmActionModal from '@/components/ConfirmActionModal'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { deleteStorageObject, extractStoragePath } from '@/lib/storage'
import { cn } from '@/lib/utils'
import type { CareerHistoryRow } from '@/hooks/useCareerTimeline'

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
const TYPE_CHIPS: { value: EntryType; label: string }[] = [
  { value: 'club', label: 'Club' },
  { value: 'national_team', label: 'National team' },
  { value: 'tournament', label: 'Tournament' },
  { value: 'achievement', label: 'Achievement' },
]
const LEGACY_LABEL: Record<string, string> = { milestone: 'Milestone', academy: 'Academy', other: 'Other' }
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

const field = 'h-[50px] w-full rounded-[12px] bg-surface-grouped px-3.5 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30'

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-secondary font-semibold text-ink-2">{children}</label>
}

export default function CareerEntryScreen({ entry, initialCrestUrl = null, nextDisplayOrder, onClose }: CareerEntryScreenProps) {
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
  const chips = entry && LEGACY_LABEL[entry.entry_type] ? [...TYPE_CHIPS, { value: entry.entry_type, label: LEGACY_LABEL[entry.entry_type] }] : TYPE_CHIPS

  const addHighlight = () => {
    const value = draftHighlight.trim()
    if (!value) return
    setHighlights((h) => [...h, value])
    setDraftHighlight('')
  }

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !user) return
    const check = validateImage(file, { maxFileSizeMB: 5 })
    if (!check.valid) { addToast(check.error ?? 'Invalid image file.', 'error'); return }
    setUploading(true)
    try {
      const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const optimized = await optimizeImage(file, { maxWidth: 800, maxHeight: 800, maxSizeMB: 1, mimeType })
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `${user.id}/journey/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, optimized, { upsert: true, cacheControl: '31536000' })
      if (error) throw error
      setImageUrl(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    } catch (err) {
      logger.error('[CareerEntryScreen] photo upload failed', err)
      addToast('We couldn’t upload this photo. Please use PNG or JPG up to 5MB.', 'error')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!user) return
    const next: typeof errors = {}
    if (!clubName.trim()) next.name = isClub ? 'Choose or type the club.' : 'Give this entry a title.'
    if (!from) next.from = 'Add the month it started.'
    if (!stillHere && to && from && to < from) next.to = 'This ends before it starts.'
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
      addToast('Entry saved.', 'success')
      onClose(true)
    } catch (err) {
      logger.error('[CareerEntryScreen] save failed', err)
      addToast('Failed to save. Please try again.', 'error')
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
      addToast('Entry removed.', 'success')
      onClose(true)
    } catch (err) {
      logger.error('[CareerEntryScreen] delete failed', err)
      addToast('Failed to delete entry. Please try again.', 'error')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="min-h-screen bg-white pb-44 lg:hidden" data-testid="career-entry-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent="Career" title={entry ? 'Career entry' : 'New entry'} onBack={() => onClose(false)} />
        <div className="flex gap-2 overflow-x-auto px-5 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Entry type">
          {chips.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={type === c.value}
              onClick={() => setType(c.value)}
              className={cn('flex h-9 shrink-0 items-center rounded-full px-3.5 text-[14px] font-semibold', type === c.value ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1')}
            >
              {c.label}
            </button>
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
              label="Club"
              value={clubName}
              onChange={setClubName}
              selectedClubId={worldClubId}
              error={errors.name}
              placeholder="Search your club"
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
            {worldClubId && <p className="mt-1.5 text-caption text-ink-3">Claimed on Hockia — crest, league and city fill in from the club.</p>}
          </div>
        ) : (
          <div>
            <Label htmlFor="career-entry-title">{isNational ? 'Team' : 'Title'}</Label>
            <input id="career-entry-title" value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder={isNational ? 'Buenos Aires Selection 2024' : 'What was it?'} className={field} />
            {errors.name && <p className="mt-1 text-caption text-red-600">{errors.name}</p>}
          </div>
        )}

        {isNational && (
          <>
            <CountrySelect appearance="field" label="Country represented" value={countryId} onChange={setCountryId} placeholder="Choose a country" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="career-entry-level">Level</Label>
                <select id="career-entry-level" value={level} onChange={(e) => setLevel(e.target.value)} className={field}>
                  <option value="">Not specified</option>
                  <option value="senior">Senior</option>
                  <option value="junior">Junior (U14–U23)</option>
                  <option value="masters">Masters</option>
                </select>
              </div>
              <div>
                <Label htmlFor="career-entry-caps">Caps</Label>
                <input id="career-entry-caps" inputMode="numeric" value={caps} onChange={(e) => setCaps(e.target.value.replace(/[^\d]/g, ''))} placeholder="Optional" className={field} />
              </div>
            </div>
          </>
        )}

        <div>
          <Label htmlFor="career-entry-role">Role</Label>
          <input id="career-entry-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Defender & coach" className={field} />
        </div>

        <div>
          <Label htmlFor="career-entry-team">Team</Label>
          <input id="career-entry-team" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="1st XI" className={field} />
        </div>

        {!isNational && (
          <div>
            <Label htmlFor="career-entry-league">League</Label>
            <div className="relative">
              <Trophy className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" strokeWidth={1.8} />
              <input id="career-entry-league" value={league} onChange={(e) => setLeague(e.target.value)} placeholder="Division One South" className={cn(field, 'pl-11')} />
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="career-entry-where">Where</Label>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" strokeWidth={1.8} />
            <input id="career-entry-where" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Rochester, England" className={cn(field, 'pl-11')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="career-entry-from">From</Label>
            <input id="career-entry-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
            {errors.from && <p className="mt-1 text-caption text-red-600">{errors.from}</p>}
          </div>
          <div>
            <Label htmlFor="career-entry-to">To</Label>
            {stillHere ? (
              <div className={cn(field, 'flex items-center text-ink-2')}>Present</div>
            ) : (
              <input id="career-entry-to" type="month" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} />
            )}
            {errors.to && <p className="mt-1 text-caption text-red-600">{errors.to}</p>}
          </div>
        </div>

        <button type="button" role="switch" aria-checked={stillHere} onClick={() => setStillHere((v) => !v)} className="flex items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-row font-semibold text-ink-1">I’m still here</span>
            <span className="block text-caption text-ink-3">Shows as “Present”{isClub ? ' and keeps this as your current club.' : '.'}</span>
          </span>
          <span className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', stillHere ? 'bg-positive' : 'bg-line')}>
            <span className={cn('absolute top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow transition-all', stillHere ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>

        <div>
          <Label>Highlights</Label>
          <ul className="flex flex-col gap-2">
            {highlights.map((h, i) => (
              <li key={`${h}-${i}`} className={cn(field, 'flex items-center gap-2')}>
                <span className="min-w-0 flex-1 truncate">{h}</span>
                <button type="button" onClick={() => setHighlights((list) => list.filter((_, j) => j !== i))} aria-label={`Remove “${h}”`} className="flex h-8 w-8 shrink-0 items-center justify-center text-ink-3"><X className="h-4 w-4" /></button>
              </li>
            ))}
            <li className={cn(field, 'flex items-center gap-2')}>
              <Plus className="h-[18px] w-[18px] shrink-0 text-hockia-primary" strokeWidth={2.2} />
              <input
                value={draftHighlight}
                onChange={(e) => setDraftHighlight(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHighlight() } }}
                onBlur={addHighlight}
                placeholder="Add a highlight"
                aria-label="Add a highlight"
                className="h-full min-w-0 flex-1 bg-transparent text-body text-ink-1 placeholder:text-hockia-primary focus:outline-none"
              />
            </li>
          </ul>
          <p className="mt-1.5 text-caption text-ink-3">Short and factual — titles, promotions, captaincy, awards. Clubs read these first.</p>
        </div>

        <div>
          <Label>Photo</Label>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
          <div className="flex items-center gap-3 rounded-card bg-surface-grouped p-3">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white text-ink-3 disabled:opacity-60" aria-label={imageUrl ? 'Replace photo' : 'Add a photo'}>
              {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : <Camera className="h-5 w-5" strokeWidth={1.8} />}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="min-w-0 flex-1 text-left">
              <span className="block text-row font-semibold text-ink-1">{uploading ? 'Uploading…' : imageUrl ? 'Replace photo' : 'Add a photo'}</span>
              <span className="block text-caption text-ink-3">Optional — a team shot or a moment from this season.</span>
            </button>
            {imageUrl ? (
              <button type="button" onClick={() => setImageUrl(null)} aria-label="Remove photo" className="flex h-9 w-9 items-center justify-center text-ink-3"><X className="h-4 w-4" /></button>
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" />
            )}
          </div>
        </div>

        {entry && (
          <button type="button" onClick={() => setConfirmDelete(true)} className="mx-auto mt-2 flex items-center gap-1.5 py-2 text-row font-semibold text-red-600">
            <Trash2 className="h-4 w-4" strokeWidth={2} /> Delete this entry
          </button>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-white px-5 pb-3 pt-3 lg:hidden">
        <button type="button" onClick={() => void save()} disabled={saving || uploading} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <ConfirmActionModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        title="Delete this entry?"
        description="It disappears from your career timeline. This cannot be undone."
        confirmLabel="Delete"
        confirmTone="danger"
        confirmLoading={deleting}
        loadingLabel="Deleting…"
      />
    </div>
  )
}
