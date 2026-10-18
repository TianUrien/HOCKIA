import type { Vacancy } from '@/lib/supabase'
import type { PostRoleDraft } from '@/lib/postRole'

/**
 * Club speed CS3 · Post again (Figma 05 205:5722): a closed role seeds a NEW
 * role with the same details. Dates, deadline and applicants start fresh, and
 * the cover photo is not carried over (the file belongs to the closed role,
 * which can still be deleted); the new role gets the club's generated cover.
 */
export function postAgainSeed(v: Vacancy): Vacancy {
  return { ...v, start_date: null, application_deadline: null, status: 'draft', published_at: null } as Vacancy
}

/** The phone form's version: a new draft (no id) from the closed role's fields. */
export function postAgainDraft(d: PostRoleDraft): PostRoleDraft {
  return { ...d, id: null, startDate: null, coverUrl: null }
}

/** "Closed 12 Sep · not filled" — the closed sheet and the start sheet rows. */
export function closedRoleLine(closedAt: string | null | undefined, closedReason: string | null | undefined, dayOf: (iso: string) => string | null): string {
  const when = closedAt ? dayOf(closedAt) : null
  return [when ? `Closed ${when}` : 'Closed', closedReason === 'filled' ? 'filled' : closedReason ? 'not filled' : null].filter(Boolean).join(' · ')
}
