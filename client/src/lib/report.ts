/**
 * Report — one flow for every surface (profiles, posts, comments, chats,
 * roles). The "…" menu item is always "Report", the sheet always the same,
 * and the reported person is told nothing. Writes go through the existing
 * report_user RPC (user_reports table; admins review them in /admin/reports).
 *
 * user_reports.content_type only knows user | post | comment, so a chat or a
 * role report files against the person (the other participant / the
 * publisher) as 'user' and carries what was reported in the reason text.
 */

export const REPORT_MENU_LABEL = 'Report'
/** Icon size/colour shared by every "…" item so all menus read the same. */
export const MENU_ICON_CLASS = 'h-[18px] w-[18px] shrink-0 text-ink-2'
export const REPORT_THANKS = "Thanks. We'll review it."

export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'impersonation', label: 'Fake account or impersonation' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'misinformation', label: 'False information' },
  { value: 'other', label: 'Something else' },
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]['value']

export type ReportSubject = 'profile' | 'post' | 'comment' | 'chat' | 'role'

export const REPORT_NOTE_MAX = 800

export interface ReportPayload {
  p_target_id: string
  p_reason: string
  p_category: ReportReason
  p_content_type: 'user' | 'post' | 'comment'
  p_content_id: string | null
}

const SUBJECT_TAG: Record<ReportSubject, string | null> = {
  profile: null,
  post: null,
  comment: null,
  chat: 'Chat',
  role: 'Role',
}

/** Builds the report_user arguments. The note is optional: without one the
 *  reason label is the text (the column is NOT NULL). */
export function buildReportPayload(o: {
  targetId: string
  subject: ReportSubject
  reason: ReportReason
  note?: string | null
  contentId?: string | null
}): ReportPayload {
  const label = REPORT_REASONS.find((r) => r.value === o.reason)?.label ?? 'Something else'
  const note = (o.note ?? '').trim().slice(0, REPORT_NOTE_MAX)
  const tag = SUBJECT_TAG[o.subject]
  const prefix = tag ? `[${tag}${o.contentId ? ` ${o.contentId}` : ''}] ` : ''
  const contentType = o.subject === 'post' ? 'post' : o.subject === 'comment' ? 'comment' : 'user'
  return {
    p_target_id: o.targetId,
    p_reason: `${prefix}${note || label}`,
    p_category: o.reason,
    p_content_type: contentType,
    p_content_id: contentType === 'user' ? null : o.contentId ?? null,
  }
}

/** Report is never offered on your own profile, post or role. */
export function canReport(viewerId: string | null | undefined, targetId: string | null | undefined): boolean {
  return Boolean(viewerId && targetId && viewerId !== targetId)
}
