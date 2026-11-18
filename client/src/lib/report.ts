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

import { tInbox } from '@/i18n/ns/inbox'

/** English menu label. Screens should prefer reportMenuLabel(), which follows the interface language. */
export const REPORT_MENU_LABEL = 'Report'
/** The "…" menu item, in the interface language. */
export function reportMenuLabel(): string {
  return tInbox('safety.report.menuLabel')
}
/** Icon size/colour shared by every "…" item so all menus read the same. */
export const MENU_ICON_CLASS = 'h-[18px] w-[18px] shrink-0 text-ink-2'
/** English thank-you toast. Screens should prefer reportThanks(). */
export const REPORT_THANKS = "Thanks. We'll review it."
/** The thank-you toast after a report, in the interface language. */
export function reportThanks(): string {
  return tInbox('safety.report.thanks')
}

/** `label` is the English text stored with the report for admins (buildReportPayload);
 *  the sheet shows reportReasonLabel(value) instead. */
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

/** A reason as the member reads it, in the interface language. */
export function reportReasonLabel(reason: ReportReason): string {
  switch (reason) {
    case 'spam': return tInbox('safety.report.reasons.spam')
    case 'impersonation': return tInbox('safety.report.reasons.impersonation')
    case 'harassment': return tInbox('safety.report.reasons.harassment')
    case 'inappropriate_content': return tInbox('safety.report.reasons.inappropriateContent')
    case 'hate_speech': return tInbox('safety.report.reasons.hateSpeech')
    case 'violence': return tInbox('safety.report.reasons.violence')
    case 'misinformation': return tInbox('safety.report.reasons.misinformation')
    default: return tInbox('safety.report.reasons.other')
  }
}

export type ReportSubject = 'profile' | 'post' | 'comment' | 'chat' | 'role' | 'feed_item' | 'feed_item_comment' | 'video' | 'offer'

export const REPORT_NOTE_MAX = 800

export interface ReportPayload {
  p_target_id: string
  p_reason: string
  p_category: ReportReason
  p_content_type: 'user' | 'post' | 'comment' | 'feed_item' | 'feed_item_comment' | 'video' | 'opportunity'
  p_content_id: string | null
}

const SUBJECT_TAG: Record<ReportSubject, string | null> = {
  profile: null,
  post: null,
  comment: null,
  chat: 'Chat',
  // A brand offer: reported against the brand's profile, tagged with the offer id.
  offer: 'Offer',
  role: null,
  feed_item: null,
  feed_item_comment: null,
  video: null,
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
  // Home v1 (20261011150200): reference cards and their comments are their
  // own content types so admins can take them down.
  const contentType =
    o.subject === 'post' || o.subject === 'comment' || o.subject === 'feed_item' || o.subject === 'feed_item_comment' || o.subject === 'video'
      ? o.subject
      // A role report targets the opportunity itself (takedown v2 removes its cover photo, 16 Oct 2026).
      : o.subject === 'role' && o.contentId ? 'opportunity'
      : 'user'
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
