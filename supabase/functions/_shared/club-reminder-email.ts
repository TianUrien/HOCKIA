/**
 * B2 · Club reminders — the three publisher emails, rendered from the pure
 * rules in club-reminders.ts:
 *
 *   1. New applications (batched, at most one per hour per publisher)
 *   2. Closing soon (day 10: 4 days left)
 *   3. Last call (day 13: 1 day left) — combined with 2 when both apply that
 *      day (Last call first; one email per publisher per local day)
 *
 * Every member-supplied value goes through escapeHtml; avatars only from
 * https URLs (renderAvatarHtml falls back to initials). The layout mirrors the
 * branded shell of email-renderer.ts (wordmark header, grey footer).
 */

import { escapeHtml } from './html-escape.ts'
import { renderAvatarHtml } from './email-renderer.ts'
import {
  type ApplicantItem,
  type ReminderItem,
  chipIsAmber,
  closesChip,
  closingSoonSubject,
  DECLINE_HINT,
  declinePath,
  lastCallBody,
  lastCallSubject,
  namesPhrase,
  newApplicationsSubject,
  peopleNoun,
  reviewPath,
  reviewTarget,
  SETTINGS_FOOTER,
  waitingLine,
} from './club-reminders.ts'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** Rows shown per list; the rest is "+N more" (the button opens them all). */
export const MAX_ROWS = 10

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const INK_1 = '#111827'
const INK_2 = '#4b5563'
const INK_3 = '#6b7280'
const BRAND = '#6d28d9'
const LINE = '#eef0f3'

function url(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function href(baseUrl: string, path: string): string {
  return escapeHtml(url(baseUrl, path))
}

function fitBadge(fit: ApplicantItem['fit']): string {
  if (fit === 'strong') {
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#ecfdf3;color:#067647;font-size:12px;font-weight:600;line-height:18px;">Strong</span>`
  }
  if (fit === 'possible') {
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#fef7c3;color:#854a0e;font-size:12px;font-weight:600;line-height:18px;">Possible</span>`
  }
  return ''
}

function closesChipHtml(item: ReminderItem): string {
  const amber = chipIsAmber(item.daysLeft)
  const style = amber ? 'background:#fffaeb;color:#b54708;' : 'background:#f2f4f7;color:#475467;'
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;${style}font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;">${escapeHtml(closesChip(item.daysLeft, item.closesLocal))}</span>`
}

/** One person row: avatar · name · "Player · position · country" · fit · closes chip. */
function personRow(item: ApplicantItem | ReminderItem, opts: { showRole: boolean }): string {
  const chip = 'daysLeft' in item ? closesChipHtml(item) : ''
  const badges = [fitBadge(item.fit), chip].filter(Boolean).join('&nbsp;')
  const role = opts.showRole
    ? `<div style="font-size:13px;color:${INK_3};line-height:18px;">${escapeHtml(item.roleTitle)}</div>`
    : ''
  return `
      <tr>
        <td width="48" valign="top" style="padding:12px 12px 12px 0;border-bottom:1px solid ${LINE};">${renderAvatarHtml(item.avatarUrl, item.applicantName, 40)}</td>
        <td valign="top" style="padding:12px 0;border-bottom:1px solid ${LINE};">
          <div style="font-size:15px;font-weight:600;color:${INK_1};line-height:20px;">${escapeHtml(item.applicantName)}</div>
          <div style="font-size:13px;color:${INK_2};line-height:18px;">${escapeHtml(item.roleLine)}</div>
          ${role}
          ${badges ? `<div style="padding-top:6px;">${badges}</div>` : ''}
        </td>
      </tr>`
}

function personTable(items: (ApplicantItem | ReminderItem)[], opts: { showRole: boolean }): string {
  const shown = items.slice(0, MAX_ROWS)
  const more = items.length - shown.length
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${shown.map((i) => personRow(i, opts)).join('')}
    </table>${more > 0 ? `\n    <p style="margin:10px 0 0;font-size:13px;color:${INK_3};">+ ${more} more waiting in HOCKIA.</p>` : ''}`
}

function primaryButton(link: string, label: string): string {
  return `<a href="${link}" style="display:inline-block;background:${BRAND};color:#ffffff;padding:12px 22px;border-radius:999px;font-size:15px;font-weight:600;text-decoration:none;line-height:20px;">${escapeHtml(label)}</a>`
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 8px;font-size:22px;line-height:28px;font-weight:700;color:${INK_1};">${escapeHtml(text)}</h1>`
}

function eyebrow(org: string | null): string {
  return org
    ? `<div style="font-size:13px;font-weight:600;color:${BRAND};letter-spacing:0.2px;margin:0 0 6px;">${escapeHtml(org)}</div>`
    : ''
}

function shell(baseUrl: string, body: string, extraFooter = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#f6f6f8;font-family:${FONT};color:${INK_1};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;">
      <tr><td style="padding:24px 22px 8px;">
        <img src="https://www.inhockia.com/brand/wordmark/hockia-wordmark-white-512w.png" alt="HOCKIA" width="102" height="28" style="height:28px;width:102px;background:#5b21b6;padding:8px 12px;border-radius:6px;" />
      </td></tr>
      <tr><td style="padding:12px 22px 8px;">${body}
      </td></tr>
      <tr><td style="padding:16px 22px 22px;border-top:1px solid ${LINE};">
        ${extraFooter ? `<p style="margin:0 0 6px;font-size:12px;color:${INK_3};line-height:18px;">${escapeHtml(extraFooter)}</p>` : ''}
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:18px;"><a href="${href(baseUrl, '/settings')}" style="color:${BRAND};text-decoration:none;">${escapeHtml(SETTINGS_FOOTER)}</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`
}

function textFooter(baseUrl: string, extra = ''): string[] {
  return ['', ...(extra ? [extra] : []), `${SETTINGS_FOOTER} ${url(baseUrl, '/settings')}`]
}

function textRow(item: ApplicantItem | ReminderItem, showRole: boolean): string {
  const bits = [item.roleLine]
  if (item.fit === 'strong') bits.push('Strong fit')
  if (item.fit === 'possible') bits.push('Possible fit')
  if ('daysLeft' in item) bits.push(closesChip(item.daysLeft, item.closesLocal))
  if (showRole) bits.push(item.roleTitle)
  return `- ${item.applicantName} (${bits.join(' · ')})`
}

function reviewLabel(items: ApplicantItem[]): string {
  if (items.length === 1) return `Review ${items[0].firstName ?? 'the application'}`
  return `Review ${items.length} ${peopleNoun(items.length, items.every((i) => i.isPlayer))}`
}

// ── 1 · New applications (batched) ───────────────────────────────────────────

export function renderNewApplicationsEmail(input: { items: ApplicantItem[]; baseUrl: string }): RenderedEmail {
  const { items, baseUrl } = input
  const subject = newApplicationsSubject(items)
  const roles = new Set(items.map((i) => i.opportunityId))
  const target = reviewTarget(items)
  const org = items[0]?.orgName ?? null
  const intro = items.length === 1
    ? `${items[0].firstName ?? 'A new applicant'} applied for ${items[0].roleTitle}.`
    : roles.size === 1
      ? `${items.length} people applied for ${items[0].roleTitle} since the last email.`
      : `${items.length} people applied for your roles since the last email.`
  const body = `
        ${eyebrow(org)}
        ${heading(subject)}
        <p style="margin:0 0 4px;font-size:15px;line-height:22px;color:${INK_2};">${escapeHtml(intro)}</p>
        ${personTable(items, { showRole: roles.size > 1 })}
        <div style="padding:20px 0 4px;">${primaryButton(href(baseUrl, target), 'Review')}</div>
        <p style="margin:12px 0 8px;font-size:13px;line-height:19px;color:${INK_3};">A quick answer, even a no, helps every player. ${escapeHtml(DECLINE_HINT.replace(/^Not the right fit\? /, ''))}</p>`
  const text = [
    subject,
    '',
    intro,
    '',
    ...items.slice(0, MAX_ROWS).map((i) => textRow(i, roles.size > 1)),
    items.length > MAX_ROWS ? `+ ${items.length - MAX_ROWS} more waiting in HOCKIA.` : '',
    '',
    `Review: ${url(baseUrl, target)}`,
    ...textFooter(baseUrl),
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')
  return { subject, html: shell(baseUrl, body), text }
}

// ── 2 + 3 · Closing soon / Last call (one email per publisher per day) ───────

export interface ReminderEmailInput {
  /** Last call items due today (shown first, one block each). */
  lastCall: ReminderItem[]
  /** Closing soon items due today (decide whether the Closing soon part shows). */
  closingSoon: ReminderItem[]
  /** Every visible pending application of the publisher, soonest first. */
  pending: ReminderItem[]
  baseUrl: string
}

function lastCallBlock(item: ReminderItem, baseUrl: string, isFirst: boolean): string {
  const name = item.firstName ?? 'the applicant'
  return `
        <div style="${isFirst ? '' : `border-top:1px solid ${LINE};margin-top:18px;padding-top:18px;`}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
            <td width="56" valign="top" style="padding:0 12px 0 0;">${renderAvatarHtml(item.avatarUrl, item.applicantName, 48)}</td>
            <td valign="top">
              <div style="font-size:16px;font-weight:600;color:${INK_1};line-height:22px;">${escapeHtml(item.applicantName)}</div>
              <div style="font-size:13px;color:${INK_2};line-height:18px;">${escapeHtml(item.roleLine)}</div>
              <div style="font-size:13px;color:${INK_3};line-height:18px;">${escapeHtml(item.roleTitle)}</div>
              <div style="padding-top:6px;">${[fitBadge(item.fit), closesChipHtml(item)].filter(Boolean).join('&nbsp;')}</div>
            </td>
          </tr></table>
          <p style="margin:14px 0 16px;font-size:15px;line-height:22px;color:${INK_2};">${escapeHtml(lastCallBody(item))}</p>
          <div>${primaryButton(href(baseUrl, reviewPath(item.opportunityId, item.applicationId)), `Review ${name}`)}</div>
          <div style="padding-top:12px;"><a href="${href(baseUrl, declinePath(item.opportunityId, item.applicationId))}" style="font-size:14px;font-weight:600;color:${BRAND};text-decoration:none;">Decline with a kind note</a></div>
        </div>`
}

export function renderReminderEmail(input: ReminderEmailInput): RenderedEmail {
  const { lastCall, closingSoon, pending, baseUrl } = input
  const lastIds = new Set(lastCall.map((i) => i.applicationId))
  const others = pending.filter((i) => !lastIds.has(i.applicationId))
  const org = pending[0]?.orgName ?? lastCall[0]?.orgName ?? null

  if (lastCall.length > 0) {
    const subject = lastCallSubject(lastCall)
    const combined = closingSoon.length > 0 && others.length > 0
    const lastFooter = `Last reminder for ${namesPhrase(lastCall.map((i) => i.firstName))}.`
    let tail = ''
    let tailText: string[] = []
    if (combined) {
      const allPlayers = others.every((i) => i.isPlayer)
      tail = `
        <div style="border-top:8px solid #f6f6f8;margin:24px -22px 0;padding:22px 22px 0;">
          <div style="font-size:13px;font-weight:600;color:#b54708;margin:0 0 6px;">Closing soon</div>
          ${heading(waitingLine(others.length, allPlayers))}
          ${personTable(others, { showRole: new Set(others.map((i) => i.opportunityId)).size > 1 })}
          <div style="padding:20px 0 4px;">${primaryButton(href(baseUrl, reviewTarget(others)), reviewLabel(others))}</div>
          <p style="margin:12px 0 8px;font-size:13px;line-height:19px;color:${INK_3};">${escapeHtml(DECLINE_HINT)}</p>
        </div>`
      tailText = ['', 'Closing soon', waitingLine(others.length, allPlayers), ...others.slice(0, MAX_ROWS).map((i) => textRow(i, true)), `${reviewLabel(others)}: ${url(baseUrl, reviewTarget(others))}`, DECLINE_HINT]
    } else if (others.length > 0) {
      const names = namesPhrase(others.map((i) => i.firstName))
      const line = `${others.length} more ${others.length === 1 ? 'is' : 'are'} waiting: ${names}.`
      tail = `
        <p style="margin:22px 0 8px;font-size:14px;line-height:20px;color:${INK_2};"><a href="${href(baseUrl, reviewTarget(others))}" style="color:${BRAND};text-decoration:none;font-weight:600;">${escapeHtml(line)}</a></p>`
      tailText = ['', `${line} ${url(baseUrl, reviewTarget(others))}`]
    }
    const body = `
        ${eyebrow(org)}
        ${heading(subject)}${lastCall.map((i, idx) => lastCallBlock(i, baseUrl, idx === 0)).join('')}${tail}`
    const text = [
      subject,
      ...lastCall.flatMap((i) => [
        '',
        `${i.applicantName} (${i.roleLine} · ${i.roleTitle})`,
        lastCallBody(i),
        `Review ${i.firstName ?? 'the application'}: ${url(baseUrl, reviewPath(i.opportunityId, i.applicationId))}`,
        `Decline with a kind note: ${url(baseUrl, declinePath(i.opportunityId, i.applicationId))}`,
      ]),
      ...tailText,
      ...textFooter(baseUrl, lastFooter),
    ].join('\n')
    return { subject, html: shell(baseUrl, body, lastFooter), text }
  }

  // Closing soon only: ALL pending applications, soonest-closing first.
  const allPlayers = pending.every((i) => i.isPlayer)
  const subject = closingSoonSubject(pending, allPlayers)
  const target = reviewTarget(pending)
  const showRole = new Set(pending.map((i) => i.opportunityId)).size > 1
  const body = `
        ${eyebrow(org)}
        ${heading(subject)}
        ${pending.length > 1 ? '' : `<p style="margin:0 0 4px;font-size:15px;line-height:22px;color:${INK_2};">${escapeHtml(waitingLine(1, allPlayers))}.</p>`}
        ${personTable(pending, { showRole })}
        <div style="padding:20px 0 4px;">${primaryButton(href(baseUrl, target), reviewLabel(pending))}</div>
        <p style="margin:12px 0 8px;font-size:13px;line-height:19px;color:${INK_3};">${escapeHtml(DECLINE_HINT)}</p>`
  const text = [
    subject,
    pending.length > 1 ? '' : `${waitingLine(1, allPlayers)}.`,
    '',
    ...pending.slice(0, MAX_ROWS).map((i) => textRow(i, showRole)),
    pending.length > MAX_ROWS ? `+ ${pending.length - MAX_ROWS} more waiting in HOCKIA.` : '',
    '',
    `${reviewLabel(pending)}: ${url(baseUrl, target)}`,
    DECLINE_HINT,
    ...textFooter(baseUrl),
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')
  return { subject, html: shell(baseUrl, body), text }
}
