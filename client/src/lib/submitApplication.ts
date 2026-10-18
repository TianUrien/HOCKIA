import * as Sentry from '@sentry/react'
import { supabase, type Vacancy } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackApplicationSubmit } from '@/lib/analytics'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { extractErrorMessage } from '@/lib/utils'

/**
 * Send an application — the one write shared by the Apply sheet and Hockia
 * AI's "Prepare my application" (handoff A4 → A5), so both hit the same
 * eligibility trigger, the same duplicate rule and the same messages.
 * `source` only tags the analytics event.
 */
export type SubmitResult =
  | { ok: true; already: boolean }
  | { ok: false; message: string }

export async function submitApplication(
  vacancy: Pick<Vacancy, 'id' | 'club_id' | 'position' | 'opportunity_type'>,
  userId: string,
  note: string,
  opts: { viewerRole?: string | null; source?: 'apply_sheet' | 'hockia_ai' } = {},
): Promise<SubmitResult> {
  if (vacancy.club_id === userId) return { ok: false, message: 'You can’t apply to your own opportunity.' }
  Sentry.addBreadcrumb({ category: 'supabase', message: 'vacancies.apply', data: { vacancyId: vacancy.id, source: opts.source ?? 'apply_sheet' }, level: 'info' })
  const trimmed = note.trim()
  const { error } = await supabase
    .from('opportunity_applications')
    .insert({
      opportunity_id: vacancy.id,
      applicant_id: userId,
      status: 'pending',
      ...(trimmed ? { metadata: { message: trimmed } } : {}),
    } as never)
  if (!error) {
    trackDbEvent('application_submit', 'vacancy', vacancy.id, { position: vacancy.position ?? undefined, source: opts.source ?? 'apply_sheet' })
    void trackApplicationSubmit(vacancy.id, vacancy.position ?? undefined)
    return { ok: true, already: false }
  }
  if (error.code === '23505') return { ok: true, already: true }
  if (error.code === '42501' || error.message?.includes('row-level security')) {
    logger.error('Role mismatch - RLS policy blocked application:', error)
    reportSupabaseError('vacancies.apply_rls_block', error, { vacancyId: vacancy.id, viewerRole: opts.viewerRole ?? null }, { feature: 'vacancies', operation: 'apply_vacancy' })
    return {
      ok: false,
      message: vacancy.opportunity_type === 'coach'
        ? 'Only coaches can apply to coach opportunities.'
        : vacancy.opportunity_type === 'player'
          ? 'Only players can apply to player opportunities.'
          : 'You cannot apply to this opportunity due to role restrictions.',
    }
  }
  // check_application_eligibility rejected it — the message is user-facing.
  if (error.code === 'P0001') return { ok: false, message: error.message || 'You are not eligible to apply to this opportunity.' }
  logger.error('Error applying to vacancy:', error)
  reportSupabaseError('vacancies.apply_error', error, { vacancyId: vacancy.id, viewerRole: opts.viewerRole ?? null }, { feature: 'vacancies', operation: 'apply_vacancy' })
  return { ok: false, message: extractErrorMessage(error, 'Failed to submit application. Please try again.') }
}
