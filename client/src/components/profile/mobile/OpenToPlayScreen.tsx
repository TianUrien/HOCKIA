import { useEffect, useMemo, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { SettingsSwitch } from '@/components/settings/settingsUi'
import { CancelSaveBar, GroupCard, SectionLabel } from './formScreenUi'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useOpenToPlay } from '@/hooks/useOpenToPlay'
import { useCountries } from '@/hooks/useCountries'
import { usePlayerLeague } from '@/hooks/usePlayerLeague'
import { useProfileScrollData } from '@/hooks/useProfileScrollData'
import { passportInputs } from '@/hooks/useProfileKeyFacts'
import { AVAILABILITY_DURATIONS, AVAILABILITY_DURATION_LABELS, isAvailabilityDuration, type AvailabilityDuration } from '@/lib/openToPlay'
import { formatDay } from '@/lib/keyFacts'
import { DOB_REQUIRED_COPY, openToPlayChecklist, openToPlayConsent, UNDER_18_COPY, type ChecklistKey } from '@/lib/openToPlayScreen'
import { cn } from '@/lib/utils'

/**
 * Open to play (Figma D2.4 395:601) — the one place a player turns Open to
 * play on or off (profile pill, Settings and Edit profile all route here).
 * Switch + When (From / For) + a live "What clubs check first" checklist with
 * Add links + the consent line. Save → set_open_to_play, which also stamps
 * availability_confirmed_at. The switch is hidden for 16–17-year-olds
 * (can_toggle_open_to_play false) with a short neutral line; no date of birth
 * → ask for it first. Turning OFF is always offered.
 */
interface OpenToPlayScreenProps {
  onDone: () => void
  /** Checklist Add links + "Add your date of birth". */
  onAdd: (key: ChecklistKey | 'dob') => void
}

const SAVE_ERROR: Record<string, string> = {
  under_18: UNDER_18_COPY,
  dob_required: DOB_REQUIRED_COPY,
  invalid_date: 'That date doesn’t look right.',
  invalid_duration: 'Choose how long you’re available for.',
}

export default function OpenToPlayScreen({ onDone, onAdd }: OpenToPlayScreenProps) {
  const profile = useAuthStore((s) => s.profile)
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const addToast = useToastStore((s) => s.addToast)
  const otp = useOpenToPlay()
  const { countries } = useCountries()
  const scroll = useProfileScrollData(profile?.id ?? null)
  const { league } = usePlayerLeague({
    playerId: profile?.id ?? null,
    worldClubId: profile?.current_world_club_id ?? null,
    playingCategory: profile?.playing_category ?? null,
    signedIn,
  })

  const [open, setOpen] = useState(otp.openToPlay)
  const [from, setFrom] = useState(otp.availableFrom ?? '')
  const [duration, setDuration] = useState<AvailabilityDuration | ''>(isAvailabilityDuration(otp.availabilityDuration) ? otp.availabilityDuration : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setOpen(otp.openToPlay) }, [otp.openToPlay])

  const checklist = useMemo(() => openToPlayChecklist({
    passports: passportInputs([profile?.nationality_country_id, profile?.nationality2_country_id], countries),
    fullMatches: scroll.fullMatches.length + scroll.fullGameLinks.length,
    highlights: scroll.highlights.length + (profile?.highlight_video_url ? 1 : 0),
    league,
  }), [profile?.nationality_country_id, profile?.nationality2_country_id, profile?.highlight_video_url, countries, scroll.fullMatches.length, scroll.fullGameLinks.length, scroll.highlights.length, league])

  if (!profile) return null
  // Under-18 / unknown age: no switch — except to turn off a legacy "on".
  const showSwitch = otp.canToggle || otp.openToPlay
  const onlyOff = !otp.canToggle

  const save = async () => {
    setError(null)
    setSaving(true)
    const result = await otp.save({ open, availableFrom: from || null, duration: duration || null })
    setSaving(false)
    if (!result.ok) {
      setError(SAVE_ERROR[result.outcome] ?? 'Could not save that. Please try again.')
      return
    }
    addToast(open ? 'You’re open to play' : 'Open to play is off', 'success')
    onDone()
  }

  return (
    <div className="min-h-screen bg-white pb-28" data-testid="open-to-play-screen">
      <CancelSaveBar title="Open to play" onCancel={onDone} onSave={() => void save()} saving={saving} saveDisabled={!showSwitch} />

      <div className="flex flex-col gap-3 px-5 pt-3">
        {otp.canToggleLoading ? (
          <div className="h-[82px] animate-pulse rounded-card bg-surface-grouped" />
        ) : showSwitch ? (
          <div className="flex items-center gap-3 rounded-card bg-surface-grouped p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold leading-[21px] text-ink-1">I’m open to play</p>
              <p className="text-secondary text-ink-2">{onlyOff ? UNDER_18_COPY : 'Clubs can find you and invite you to apply.'}</p>
            </div>
            <SettingsSwitch label="I’m open to play" checked={open} disabled={saving || (onlyOff && !open)} onChange={() => setOpen((v) => (onlyOff ? false : !v))} />
          </div>
        ) : otp.needsDob ? (
          <div className="flex flex-col gap-2 rounded-card bg-surface-grouped p-4" data-testid="open-to-play-dob">
            <p className="text-[16px] font-semibold leading-[21px] text-ink-1">Add your date of birth</p>
            <p className="text-secondary text-ink-2">{DOB_REQUIRED_COPY}</p>
            <button type="button" onClick={() => onAdd('dob')} className="self-start text-row font-semibold text-hockia-primary">Add date of birth</button>
          </div>
        ) : (
          <div className="rounded-card bg-surface-grouped p-4" data-testid="open-to-play-under-18">
            <p className="text-[16px] font-semibold leading-[21px] text-ink-1">Open to play</p>
            <p className="mt-0.5 text-secondary text-ink-2">{UNDER_18_COPY}</p>
          </div>
        )}

        {showSwitch && open && !onlyOff && (
          <>
            <SectionLabel>When</SectionLabel>
            <GroupCard>
              <label className="flex items-center gap-2.5 py-[13px]">
                <span className="flex-1 text-[16px] leading-[21px] text-ink-1">From</span>
                <span className="relative">
                  <span className={cn('text-row', from ? 'text-ink-1' : 'text-ink-2')}>{formatDay(from) ?? 'Choose a date'}</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Available from" className="absolute inset-0 opacity-0" />
                </span>
              </label>
              <label className="flex items-center gap-2.5 py-[13px]">
                <span className="flex-1 text-[16px] leading-[21px] text-ink-1">For</span>
                <select value={duration} onChange={(e) => setDuration(e.target.value as AvailabilityDuration | '')} aria-label="Available for" className="appearance-none bg-transparent text-right text-row text-ink-2 focus:outline-none">
                  <option value="">Choose</option>
                  {AVAILABILITY_DURATIONS.map((d) => <option key={d} value={d}>{AVAILABILITY_DURATION_LABELS[d]}</option>)}
                </select>
              </label>
            </GroupCard>
          </>
        )}

        <SectionLabel>What clubs check first</SectionLabel>
        <GroupCard>
          {checklist.map((row) => (
            <div key={row.key} className="flex items-center gap-2.5 py-3" data-testid={`otp-check-${row.key}`}>
              {row.done ? (
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-positive text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
              ) : (
                <span className="h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] border-ink-4 bg-white" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-row font-semibold text-ink-1">{row.label}</span>
                <span className="block truncate text-secondary text-ink-2">{row.detail}</span>
              </span>
              {!row.done && <button type="button" onClick={() => onAdd(row.key)} className="text-row font-semibold text-hockia-primary">Add</button>}
            </div>
          ))}
        </GroupCard>

        {showSwitch && !onlyOff && (
          <div className="flex items-start gap-2.5 rounded-card bg-hockia-soft p-3.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-hockia-primary" strokeWidth={2} aria-hidden="true" />
            <p className="text-secondary text-ink-1">{openToPlayConsent(open, profile.position)}</p>
          </div>
        )}

        {error && <p role="alert" className="text-secondary text-red-600">{error}</p>}
      </div>
    </div>
  )
}
