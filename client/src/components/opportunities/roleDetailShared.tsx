import { useEffect, useState } from 'react'
import { closesSoonLabel } from '@/lib/opportunityCopy'
import { supabase } from '@/lib/supabase'
import type { Vacancy } from '@/lib/supabase'
import { clubNoteFromFeedback, formatDurationText } from '@/lib/opportunityCopy'
import { dayFirst } from '@/lib/dayFirst'
import { daysUntil } from '@/lib/opportunityRails'
import { getShareOrigin } from '@/lib/profileShare'

/**
 * The applicant's OWN application row (RLS: applicant_id = auth.uid()): the
 * club's decline note and the applied date. Never other applicants or counts.
 * Shared by the phone and desktop role pages.
 */
export function useOwnApplicationRow(vacancyId: string, userId: string | null, enabled: boolean, applicationStatus: string | null) {
  const [clubNote, setClubNote] = useState<string | null>(null)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !userId) { setClubNote(null); setAppliedAt(null); return }
    let cancelled = false
    void supabase
      .from('opportunity_applications')
      .select('applied_at, ai_feedback')
      .eq('opportunity_id', vacancyId)
      .eq('applicant_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const row = data as { applied_at?: string | null; ai_feedback?: unknown } | null
        setClubNote(clubNoteFromFeedback(row?.ai_feedback, applicationStatus))
        setAppliedAt(row?.applied_at ?? null)
      })
    return () => { cancelled = true }
  }, [enabled, applicationStatus, userId, vacancyId])
  return { clubNote, appliedAt }
}

/** Share the role's public link: the OS share sheet when there is one, else the clipboard. */
export async function shareRole(vacancy: Vacancy, title: string, addToast: (message: string, kind: 'success' | 'error') => void) {
  const url = `${getShareOrigin()}/opportunities/${vacancy.id}`
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, url })
      return
    }
    await navigator.clipboard.writeText(url)
    addToast('Link copied', 'success')
  } catch (err) {
    if (!(err instanceof Error && err.name === 'AbortError')) addToast('Could not share this opportunity', 'error')
  }
}

/** Starts / duration / Apply by, as the key facts and the asks table read them. */
export function roleDates(vacancy: Vacancy) {
  const deadlineDays = daysUntil(vacancy.application_deadline)
  const startsValue = (() => {
    if (!vacancy.start_date) return 'Immediately'
    const d = new Date(vacancy.start_date)
    return Number.isNaN(d.getTime()) ? 'Immediately' : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  })()
  const duration = formatDurationText(vacancy.duration_text)
  const applyByValue = vacancy.application_deadline ? dayFirst(vacancy.application_deadline, { year: 'never' }) ?? 'Open' : 'Open'
  const applyBySub = vacancy.application_deadline
    ? (deadlineDays !== null && deadlineDays >= 0 ? closesSoonLabel(vacancy.application_deadline) : 'Deadline passed')
    : 'Until filled'
  return { deadlineDays, startsValue, duration, applyByValue, applyBySub }
}
