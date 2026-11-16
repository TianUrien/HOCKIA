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
 * https URLs (renderAvatarHtml falls back to the role placeholder). The layout mirrors the
 * branded shell of email-renderer.ts (wordmark header, grey footer).
 *
 * Language (Stage 3, 2026-11-16): both renderers take an optional `lang`
 * (the publisher's interface language); English output is unchanged.
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
  DECLINE_HINT_ES,
  declinePath,
  lastCallBody,
  lastCallSubject,
  namesPhrase,
  newApplicationsSubject,
  peopleNoun,
  reviewPath,
  reviewTarget,
  SETTINGS_FOOTER,
  SETTINGS_FOOTER_ES,
  SETTINGS_FOOTER_PATH,
  type ReminderLanguage,
  closingSoonHeadline,
  waitingLine,
} from './club-reminders.ts'
import { EMAIL_LOGO_HTML } from './email-brand.ts'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** Rows shown per list; the rest is "+N more" (the button opens them all). */
export const MAX_ROWS = 10

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const INK_1 = '#0e0b1a'
const INK_2 = '#5a5766'
const INK_3 = '#6b6878'
const BRAND = '#6c2bd9'
const LINE = '#e6e3ee'

function url(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function href(baseUrl: string, path: string): string {
  return escapeHtml(url(baseUrl, path))
}

/** Fixed words of the three emails (Spanish: client es/recruiting.json fit words). */
const COPY = {
  en: {
    strongFit: 'Strong fit',
    possibleFit: 'Possible fit',
    moreWaiting: (n: number) => `+ ${n} more waiting in Hockia.`,
    review: 'Review',
    reviewName: (name: string | null) => `Review ${name ?? 'the application'}`,
    reviewMany: (n: number, noun: string) => `Review ${n} ${noun}`,
    newOne: (name: string | null, role: string) => `${name ?? 'A new applicant'} applied for ${role}.`,
    newOneRole: (n: number, role: string) => `${n} people applied for ${role} since the last email.`,
    newManyRoles: (n: number) => `${n} people applied for your opportunities since the last email.`,
    quickAnswer: 'A quick answer, even a no, helps every player.',
    declineHintShort: DECLINE_HINT.replace(/^Not the right fit\? /, ''),
    declineHint: DECLINE_HINT,
    settingsFooter: SETTINGS_FOOTER,
    notAFit: 'Not a fit, with a kind note',
    lastReminder: (names: string) => `Last reminder for ${names}.`,
    closingSoon: 'Closing soon',
    moreAreWaiting: (n: number, names: string) => `${n} more ${n === 1 ? 'is' : 'are'} waiting: ${names}.`,
    theApplicant: 'the applicant',
  },
  es: {
    strongFit: 'Encaje alto',
    possibleFit: 'Encaje posible',
    moreWaiting: (n: number) => `+ ${n} más ${n === 1 ? 'espera' : 'esperan'} en Hockia.`,
    review: 'Revisar',
    reviewName: (name: string | null) => (name ? `Revisar a ${name}` : 'Revisar la postulación'),
    reviewMany: (n: number, noun: string) => `Revisar ${n} ${noun}`,
    newOne: (name: string | null, role: string) => `${name ?? 'Una persona'} se postuló a ${role}.`,
    newOneRole: (n: number, role: string) => `${n} personas se postularon a ${role} desde el último email.`,
    newManyRoles: (n: number) => `${n} personas se postularon a tus oportunidades desde el último email.`,
    quickAnswer: 'Una respuesta rápida, aunque sea un no, ayuda a cada deportista.',
    declineHintShort: DECLINE_HINT_ES.replace(/^¿No encaja\? /, ''),
    declineHint: DECLINE_HINT_ES,
    settingsFooter: SETTINGS_FOOTER_ES,
    notAFit: 'No encaja, con una nota amable',
    lastReminder: (names: string) => `Último recordatorio sobre ${names}.`,
    closingSoon: 'Cierran pronto',
    moreAreWaiting: (n: number, names: string) => `${n} más ${n === 1 ? 'espera' : 'esperan'}: ${names}.`,
    theApplicant: 'la persona',
  },
} as const

type Copy = typeof COPY['en'] | typeof COPY['es']

function fitBadge(fit: ApplicantItem['fit'], c: Copy = COPY.en): string {
  if (fit === 'strong') {
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#15803d;font-size:12px;font-weight:600;line-height:18px;">${c.strongFit}</span>`
  }
  if (fit === 'possible') {
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#f1eff6;color:#6b6878;font-size:12px;font-weight:600;line-height:18px;">${c.possibleFit}</span>`
  }
  return ''
}

function closesChipHtml(item: ReminderItem, lang: ReminderLanguage = 'en'): string {
  const amber = chipIsAmber(item.daysLeft)
  const style = amber ? 'background:#fdf1e4;color:#b45309;' : 'background:#f1eff6;color:#6b6878;'
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;${style}font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;">${escapeHtml(closesChip(item.daysLeft, item.closesLocal, lang))}</span>`
}

/** One person row: avatar · name · "Player · position · country" · fit · closes chip. */
function personRow(item: ApplicantItem | ReminderItem, opts: { showRole: boolean; lang?: ReminderLanguage }): string {
  const lang = opts.lang ?? 'en'
  const chip = 'daysLeft' in item ? closesChipHtml(item, lang) : ''
  const badges = [fitBadge(item.fit, COPY[lang]), chip].filter(Boolean).join('&nbsp;')
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

function personTable(items: (ApplicantItem | ReminderItem)[], opts: { showRole: boolean; lang?: ReminderLanguage }): string {
  const c = COPY[opts.lang ?? 'en']
  const shown = items.slice(0, MAX_ROWS)
  const more = items.length - shown.length
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${shown.map((i) => personRow(i, opts)).join('')}
    </table>${more > 0 ? `\n    <p style="margin:10px 0 0;font-size:13px;color:${INK_3};">${escapeHtml(c.moreWaiting(more))}</p>` : ''}`
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

function shell(baseUrl: string, body: string, extraFooter = '', lang: ReminderLanguage = 'en'): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#f1eff6;font-family:${FONT};color:${INK_1};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;">
      <tr><td style="padding:24px 22px 8px;">
        ${EMAIL_LOGO_HTML}
      </td></tr>
      <tr><td style="padding:12px 22px 8px;">${body}
      </td></tr>
      <tr><td style="padding:16px 22px 22px;border-top:1px solid ${LINE};">
        ${extraFooter ? `<p style="margin:0 0 6px;font-size:12px;color:${INK_3};line-height:18px;">${escapeHtml(extraFooter)}</p>` : ''}
        <p style="margin:0;font-size:12px;color:#73707c;line-height:18px;"><a href="${href(baseUrl, SETTINGS_FOOTER_PATH)}" style="color:${BRAND};text-decoration:none;">${escapeHtml(COPY[lang].settingsFooter)}</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`
}

function textFooter(baseUrl: string, extra = '', lang: ReminderLanguage = 'en'): string[] {
  return ['', ...(extra ? [extra] : []), `${COPY[lang].settingsFooter} ${url(baseUrl, SETTINGS_FOOTER_PATH)}`]
}

function textRow(item: ApplicantItem | ReminderItem, showRole: boolean, lang: ReminderLanguage = 'en'): string {
  const c = COPY[lang]
  const bits = [item.roleLine]
  if (item.fit === 'strong') bits.push(c.strongFit)
  if (item.fit === 'possible') bits.push(c.possibleFit)
  if ('daysLeft' in item) bits.push(closesChip(item.daysLeft, item.closesLocal, lang))
  if (showRole) bits.push(item.roleTitle)
  return `- ${item.applicantName} (${bits.join(' · ')})`
}

function reviewLabel(items: ApplicantItem[], lang: ReminderLanguage = 'en'): string {
  const c = COPY[lang]
  if (items.length === 1) return c.reviewName(items[0].firstName)
  return c.reviewMany(items.length, peopleNoun(items.length, items.every((i) => i.isPlayer), lang))
}

// ── 1 · New applications (batched) ───────────────────────────────────────────

export function renderNewApplicationsEmail(input: { items: ApplicantItem[]; baseUrl: string; lang?: ReminderLanguage }): RenderedEmail {
  const { items, baseUrl } = input
  const lang = input.lang ?? 'en'
  const c = COPY[lang]
  const subject = newApplicationsSubject(items, lang)
  const roles = new Set(items.map((i) => i.opportunityId))
  const target = reviewTarget(items)
  const org = items[0]?.orgName ?? null
  const intro = items.length === 1
    ? c.newOne(items[0].firstName, items[0].roleTitle)
    : roles.size === 1
      ? c.newOneRole(items.length, items[0].roleTitle)
      : c.newManyRoles(items.length)
  const body = `
        ${eyebrow(org)}
        ${heading(subject)}
        <p style="margin:0 0 4px;font-size:15px;line-height:22px;color:${INK_2};">${escapeHtml(intro)}</p>
        ${personTable(items, { showRole: roles.size > 1, lang })}
        <div style="padding:20px 0 4px;">${primaryButton(href(baseUrl, target), c.review)}</div>
        <p style="margin:12px 0 8px;font-size:13px;line-height:19px;color:${INK_3};">${c.quickAnswer} ${escapeHtml(c.declineHintShort)}</p>`
  const text = [
    subject,
    '',
    intro,
    '',
    ...items.slice(0, MAX_ROWS).map((i) => textRow(i, roles.size > 1, lang)),
    items.length > MAX_ROWS ? c.moreWaiting(items.length - MAX_ROWS) : '',
    '',
    `${c.review}: ${url(baseUrl, target)}`,
    ...textFooter(baseUrl, '', lang),
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')
  return { subject, html: shell(baseUrl, body, '', lang), text }
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
  /** The publisher's interface language; English when absent. */
  lang?: ReminderLanguage
}

function lastCallBlock(item: ReminderItem, baseUrl: string, isFirst: boolean, lang: ReminderLanguage = 'en'): string {
  const c = COPY[lang]
  const name = item.firstName ?? c.theApplicant
  return `
        <div style="${isFirst ? '' : `border-top:1px solid ${LINE};margin-top:18px;padding-top:18px;`}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
            <td width="56" valign="top" style="padding:0 12px 0 0;">${renderAvatarHtml(item.avatarUrl, item.applicantName, 48)}</td>
            <td valign="top">
              <div style="font-size:16px;font-weight:600;color:${INK_1};line-height:22px;">${escapeHtml(item.applicantName)}</div>
              <div style="font-size:13px;color:${INK_2};line-height:18px;">${escapeHtml(item.roleLine)}</div>
              <div style="font-size:13px;color:${INK_3};line-height:18px;">${escapeHtml(item.roleTitle)}</div>
              <div style="padding-top:6px;">${[fitBadge(item.fit, c), closesChipHtml(item, lang)].filter(Boolean).join('&nbsp;')}</div>
            </td>
          </tr></table>
          <p style="margin:14px 0 16px;font-size:15px;line-height:22px;color:${INK_2};">${escapeHtml(lastCallBody(item, lang))}</p>
          <div>${primaryButton(href(baseUrl, reviewPath(item.opportunityId, item.applicationId)), lang === 'es' ? c.reviewName(item.firstName) : `Review ${name}`)}</div>
          <div style="padding-top:12px;"><a href="${href(baseUrl, declinePath(item.opportunityId, item.applicationId))}" style="font-size:14px;font-weight:600;color:${BRAND};text-decoration:none;">${c.notAFit}</a></div>
        </div>`
}

export function renderReminderEmail(input: ReminderEmailInput): RenderedEmail {
  const { lastCall, closingSoon, pending, baseUrl } = input
  const lang = input.lang ?? 'en'
  const c = COPY[lang]
  const lastIds = new Set(lastCall.map((i) => i.applicationId))
  const others = pending.filter((i) => !lastIds.has(i.applicationId))
  const org = pending[0]?.orgName ?? lastCall[0]?.orgName ?? null

  if (lastCall.length > 0) {
    const subject = lastCallSubject(lastCall, lang)
    const combined = closingSoon.length > 0 && others.length > 0
    const lastFooter = c.lastReminder(namesPhrase(lastCall.map((i) => i.firstName), lang))
    let tail = ''
    let tailText: string[] = []
    if (combined) {
      const allPlayers = others.every((i) => i.isPlayer)
      tail = `
        <div style="border-top:8px solid #f1eff6;margin:24px -22px 0;padding:22px 22px 0;">
          <div style="font-size:13px;font-weight:600;color:#b45309;margin:0 0 6px;">${c.closingSoon}</div>
          ${heading(waitingLine(others.length, allPlayers, lang))}
          ${personTable(others, { showRole: new Set(others.map((i) => i.opportunityId)).size > 1, lang })}
          <div style="padding:20px 0 4px;">${primaryButton(href(baseUrl, reviewTarget(others)), reviewLabel(others, lang))}</div>
          <p style="margin:12px 0 8px;font-size:13px;line-height:19px;color:${INK_3};">${escapeHtml(c.declineHint)}</p>
        </div>`
      tailText = ['', c.closingSoon, waitingLine(others.length, allPlayers, lang), ...others.slice(0, MAX_ROWS).map((i) => textRow(i, true, lang)), `${reviewLabel(others, lang)}: ${url(baseUrl, reviewTarget(others))}`, c.declineHint]
    } else if (others.length > 0) {
      const names = namesPhrase(others.map((i) => i.firstName), lang)
      const line = c.moreAreWaiting(others.length, names)
      tail = `
        <p style="margin:22px 0 8px;font-size:14px;line-height:20px;color:${INK_2};"><a href="${href(baseUrl, reviewTarget(others))}" style="color:${BRAND};text-decoration:none;font-weight:600;">${escapeHtml(line)}</a></p>`
      tailText = ['', `${line} ${url(baseUrl, reviewTarget(others))}`]
    }
    const body = `
        ${eyebrow(org)}
        ${heading(subject)}${lastCall.map((i, idx) => lastCallBlock(i, baseUrl, idx === 0, lang)).join('')}${tail}`
    const text = [
      subject,
      ...lastCall.flatMap((i) => [
        '',
        `${i.applicantName} (${i.roleLine} · ${i.roleTitle})`,
        lastCallBody(i, lang),
        `${c.reviewName(i.firstName)}: ${url(baseUrl, reviewPath(i.opportunityId, i.applicationId))}`,
        `${c.notAFit}: ${url(baseUrl, declinePath(i.opportunityId, i.applicationId))}`,
      ]),
      ...tailText,
      ...textFooter(baseUrl, lastFooter, lang),
    ].join('\n')
    return { subject, html: shell(baseUrl, body, lastFooter, lang), text }
  }

  // Closing soon only: ALL pending applications, soonest-closing first.
  const allPlayers = pending.every((i) => i.isPlayer)
  const subject = closingSoonSubject(pending, allPlayers, lang)
  const target = reviewTarget(pending)
  const showRole = new Set(pending.map((i) => i.opportunityId)).size > 1
  const body = `
        ${eyebrow(org)}
        ${heading(closingSoonHeadline(pending, allPlayers, lang))}
        ${pending.length > 1 ? '' : `<p style="margin:0 0 4px;font-size:15px;line-height:22px;color:${INK_2};">${escapeHtml(waitingLine(1, allPlayers, lang))}.</p>`}
        ${personTable(pending, { showRole, lang })}
        <div style="padding:20px 0 4px;">${primaryButton(href(baseUrl, target), reviewLabel(pending, lang))}</div>
        <p style="margin:12px 0 8px;font-size:13px;line-height:19px;color:${INK_3};">${escapeHtml(c.declineHint)}</p>`
  const text = [
    closingSoonHeadline(pending, allPlayers, lang),
    pending.length > 1 ? '' : `${waitingLine(1, allPlayers, lang)}.`,
    '',
    ...pending.slice(0, MAX_ROWS).map((i) => textRow(i, showRole, lang)),
    pending.length > MAX_ROWS ? c.moreWaiting(pending.length - MAX_ROWS) : '',
    '',
    `${reviewLabel(pending, lang)}: ${url(baseUrl, target)}`,
    c.declineHint,
    ...textFooter(baseUrl, '', lang),
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')
  return { subject, html: shell(baseUrl, body, '', lang), text }
}
