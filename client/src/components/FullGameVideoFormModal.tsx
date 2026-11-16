import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Lock, X } from 'lucide-react'
import Button from './Button'
import Input from './Input'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { useToastStore } from '@/lib/toast'
import { useAuthStore } from '@/lib/auth'
import { fullMatchVisibilityOf } from '@/lib/recruiter'
import { validateFullMatchUrl } from '@/lib/videoUrlValidator'
import type { FullGameVideo, FullGameVideoVisibility } from '@/hooks/useFullGameVideos'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { useMediaT } from '@/i18n/ns/media'
import { useEnumsT } from '@/i18n/ns/enums'

/**
 * FullGameVideoFormModal — add or edit a single full match video.
 *
 * Any https link is accepted (validateFullMatchUrl): matches live on many
 * sites and are only ever opened in a new tab. YouTube / Vimeo / Drive links
 * keep the same canonical form as the highlight-video flow.
 *
 * Visibility starts from the player's master switch
 * (profiles.full_match_visibility, Settings › Privacy); 'recruiters' means
 * clubs and coaches who recruit. RLS enforces the actual filtering — the
 * toggle just picks which side the row falls on.
 *
 * URL-only — no file upload. Direct upload is a future storage sprint.
 */

interface FullGameVideoFormModalProps {
  isOpen: boolean
  onClose: () => void
  /** When set, the modal opens in edit mode pre-populated from this row. */
  initialValue?: FullGameVideo | null
  onSubmit: (input: {
    video_url: string
    match_title: string
    match_date: string | null
    competition: string | null
    player_team: string | null
    opponent_team: string | null
    position_played: string | null
    shirt_number: number | null
    minutes_played: number | null
    visibility: FullGameVideoVisibility
    notes: string | null
  }) => Promise<boolean>
}

// Stored values (English); their labels are translated where rendered.
const POSITIONS = [
  '',
  'Goalkeeper',
  'Defender',
  'Midfielder',
  'Forward',
  'Other',
]

export default function FullGameVideoFormModal({
  isOpen,
  onClose,
  initialValue,
  onSubmit,
}: FullGameVideoFormModalProps) {
  // Bottom sheet on phones: lift it above the iOS keyboard.
  const t = useMediaT()
  const tEnum = useEnumsT()
  const positionLabels: Record<string, string> = {
    Goalkeeper: tEnum('position.goalkeeper'),
    Defender: tEnum('position.defender'),
    Midfielder: tEnum('position.midfielder'),
    Forward: tEnum('position.forward'),
    Other: t('fullGameForm.positionOther'),
  }
  const kb = useKeyboardInset(isOpen)
  const { addToast } = useToastStore()
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const titleId = useId()
  const urlInputId = useId()

  const [videoUrl, setVideoUrl] = useState('')
  const [matchTitle, setMatchTitle] = useState('')
  const [matchDate, setMatchDate] = useState('')
  const [competition, setCompetition] = useState('')
  const [playerTeam, setPlayerTeam] = useState('')
  const [opponentTeam, setOpponentTeam] = useState('')
  const [positionPlayed, setPositionPlayed] = useState('')
  const [shirtNumber, setShirtNumber] = useState<string>('')
  const [minutesPlayed, setMinutesPlayed] = useState<string>('')
  const fullMatchDefault = useAuthStore((s) => fullMatchVisibilityOf(s.profile))
  const [visibility, setVisibility] = useState<FullGameVideoVisibility>(fullMatchDefault)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const isEditing = Boolean(initialValue)

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: inputRef })

  // Reset state when modal opens (and pre-fill in edit mode).
  useEffect(() => {
    if (!isOpen) return
    if (initialValue) {
      setVideoUrl(initialValue.video_url)
      setMatchTitle(initialValue.match_title)
      setMatchDate(initialValue.match_date ?? '')
      setCompetition(initialValue.competition ?? '')
      setPlayerTeam(initialValue.player_team ?? '')
      setOpponentTeam(initialValue.opponent_team ?? '')
      setPositionPlayed(initialValue.position_played ?? '')
      setShirtNumber(initialValue.shirt_number?.toString() ?? '')
      setMinutesPlayed(initialValue.minutes_played?.toString() ?? '')
      setVisibility((initialValue.visibility as FullGameVideoVisibility) ?? fullMatchDefault)
      setNotes(initialValue.notes ?? '')
    } else {
      setVideoUrl('')
      setMatchTitle('')
      setMatchDate('')
      setCompetition('')
      setPlayerTeam('')
      setOpponentTeam('')
      setPositionPlayed('')
      setShirtNumber('')
      setMinutesPlayed('')
      setVisibility(fullMatchDefault)
      setNotes('')
    }
    setError('')
  }, [isOpen, initialValue, fullMatchDefault])

  // Esc-to-close (disabled mid-save so we don't drop a request).
  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent) => {
      // Another trapped overlay is on top: its Escape closes it, not this one.
      if (event.key === 'Escape' && !isTopFocusTrap(dialogRef.current)) return
      if (event.key === 'Escape' && !isSaving) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, isSaving, onClose])

  if (!isOpen) return null

  const handleSubmit = async () => {
    setError('')

    if (!matchTitle.trim()) {
      setError(t('fullGameForm.errors.titleRequired'))
      return
    }
    if (matchTitle.trim().length > 120) {
      setError(t('fullGameForm.errors.titleTooLong'))
      return
    }

    const normalizedUrl = validateFullMatchUrl(videoUrl)
    if (!normalizedUrl) {
      setError(t('fullGameForm.errors.badLink'))
      return
    }

    const shirtNum = shirtNumber.trim() ? Number(shirtNumber) : null
    if (shirtNum !== null && (Number.isNaN(shirtNum) || shirtNum < 0 || shirtNum > 99)) {
      setError(t('fullGameForm.errors.shirtRange'))
      return
    }
    const minsNum = minutesPlayed.trim() ? Number(minutesPlayed) : null
    if (minsNum !== null && (Number.isNaN(minsNum) || minsNum < 0 || minsNum > 200)) {
      setError(t('fullGameForm.errors.minutesRange'))
      return
    }

    setIsSaving(true)
    try {
      const ok = await onSubmit({
        video_url: normalizedUrl,
        match_title: matchTitle.trim(),
        match_date: matchDate || null,
        competition: competition.trim() || null,
        player_team: playerTeam.trim() || null,
        opponent_team: opponentTeam.trim() || null,
        position_played: positionPlayed.trim() || null,
        shirt_number: shirtNum,
        minutes_played: minsNum,
        visibility,
        notes: notes.trim() || null,
      })

      if (ok) {
        addToast(isEditing ? t('fullGameForm.toastUpdated') : t('fullGameForm.toastAdded'), 'success')
        onClose()
      } else {
        setError(t('fullGameForm.errors.saveFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fullGameForm.errors.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      style={kb.inset ? { paddingBottom: kb.inset } : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl"
        style={kb.inset ? { maxHeight: `calc(${kb.visible}px - env(safe-area-inset-top) - 12px)` } : undefined}
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">
              {isEditing ? t('fullGameForm.titleEdit') : t('fullGameForm.titleAdd')}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {t('fullGameForm.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label={t('fullGameForm.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="space-y-4">
            <Input
              ref={inputRef}
              id={urlInputId}
              label={t('fullGameForm.linkLabel')}
              placeholder={t('fullGameForm.linkPlaceholder')}
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={isSaving}
              autoCapitalize="off"
            />

            <Input
              label={t('fullGameForm.matchTitleLabel')}
              placeholder={t('fullGameForm.matchTitlePlaceholder')}
              value={matchTitle}
              onChange={(e) => setMatchTitle(e.target.value)}
              disabled={isSaving}
              maxLength={120}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('fullGameForm.dateLabel')}
                type="date"
                value={matchDate}
                onChange={(e) => setMatchDate(e.target.value)}
                disabled={isSaving}
              />
              <Input
                label={t('fullGameForm.competitionLabel')}
                placeholder={t('fullGameForm.competitionPlaceholder')}
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                disabled={isSaving}
                maxLength={120}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('fullGameForm.teamLabel')}
                placeholder={t('fullGameForm.teamPlaceholder')}
                value={playerTeam}
                onChange={(e) => setPlayerTeam(e.target.value)}
                disabled={isSaving}
                maxLength={120}
              />
              <Input
                label={t('fullGameForm.opponentLabel')}
                placeholder={t('fullGameForm.opponentPlaceholder')}
                value={opponentTeam}
                onChange={(e) => setOpponentTeam(e.target.value)}
                disabled={isSaving}
                maxLength={120}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">{t('fullGameForm.positionLabel')}</label>
                <select
                  value={positionPlayed}
                  onChange={(e) => setPositionPlayed(e.target.value)}
                  disabled={isSaving}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-hockia-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30 disabled:opacity-60"
                >
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {p ? positionLabels[p] ?? p : '—'}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label={t('fullGameForm.shirtLabel')}
                type="number"
                min={0}
                max={99}
                value={shirtNumber}
                onChange={(e) => setShirtNumber(e.target.value)}
                disabled={isSaving}
              />
              <Input
                label={t('fullGameForm.minutesLabel')}
                type="number"
                min={0}
                max={200}
                value={minutesPlayed}
                onChange={(e) => setMinutesPlayed(e.target.value)}
                disabled={isSaving}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">{t('fullGameForm.notesLabel')}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSaving}
                maxLength={500}
                rows={2}
                placeholder={t('fullGameForm.notesPlaceholder')}
                className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-hockia-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30 disabled:opacity-60"
              />
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="mb-2 text-xs font-medium text-gray-700">{t('fullGameForm.visibilityQuestion')}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:border-hockia-primary/40">
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={() => setVisibility('public')}
                    disabled={isSaving}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-gray-900">{t('fullGameForm.publicLabel')}</span>
                    <span className="block text-xs text-gray-500">{t('fullGameForm.publicHint')}</span>
                  </span>
                </label>
                <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:border-hockia-primary/40">
                  <input
                    type="radio"
                    name="visibility"
                    value="recruiters"
                    checked={visibility === 'recruiters'}
                    onChange={() => setVisibility('recruiters')}
                    disabled={isSaving}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-gray-900 inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" /> {t('fullGameForm.recruitersLabel')}
                    </span>
                    <span className="block text-xs text-gray-500">{t('fullGameForm.recruitersHint')}</span>
                  </span>
                </label>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3 sm:px-6">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t('fullGameForm.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('fullGameForm.saving')}
              </>
            ) : isEditing ? (
              t('fullGameForm.saveChanges')
            ) : (
              t('fullGameForm.addVideo')
            )}
          </Button>
        </footer>
      </div>
    </div>
  )
}
