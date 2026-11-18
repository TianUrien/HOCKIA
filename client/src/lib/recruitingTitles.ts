import { currentLanguage } from '@/i18n'
import { tInbox } from '@/i18n/ns/inbox'
import { tNotifications } from '@/i18n/ns/notifications'

/**
 * recruiting_update titles in the active language. The SQL functions
 * (migration 20260928120000_recruiting_server_functions.sql and later
 * redefinitions) store an English title built as format('<pattern>', <name>).
 * In Spanish the name is read back out of that title with the same pattern
 * and the line rebuilt from the catalog; anything unrecognised is shown as
 * stored, and English is always shown as stored. The stored data is unchanged.
 * MIRRORED in supabase/functions/send-push/push-payload.ts (recruitingTitleEs).
 */
const PATTERNS: Record<string, { re: RegExp; key: string }[]> = {
  invite_received: [{ re: /^(.+) invited you to apply$/, key: 'inviteReceived' }],
  invite_declined: [{ re: /^(.+) passed on your invite$/, key: 'inviteDeclined' }],
  offer_received: [
    { re: /^(.+) sent you an offer$/, key: 'offerSent' },
    { re: /^(.+) updated its offer$/, key: 'offerUpdated' },
  ],
  offer_withdrawn: [{ re: /^(.+) withdrew its offer$/, key: 'offerWithdrawn' }],
  offer_accepted: [{ re: /^(.+) accepted your offer$/, key: 'offerAccepted' }],
  offer_declined: [{ re: /^(.+) declined your offer$/, key: 'offerDeclined' }],
  offer_expired: [{ re: /^Your offer to (.+) expired$/, key: 'offerExpired' }],
  application_withdrawn: [{ re: /^(.+) withdrew their application$/, key: 'applicationWithdrawn' }],
  signing_marked: [{ re: /^Confirm your signing with (.+)$/, key: 'signingMarked' }],
  signing_undone: [{ re: /^(.+) undid the signing$/, key: 'signingUndone' }],
  signing_confirmed: [{ re: /^(.+) confirmed the signing$/, key: 'signingConfirmed' }],
  signing_expired: [{ re: /^(.+) didn[’']t confirm the signing in 14 days$/, key: 'signingExpired' }],
}

/** The English fallbacks the SQL writes when a name is missing. */
const FALLBACK_NAMES: Record<string, string> = {
  'A club': 'aClub',
  'The club': 'theClub',
  'the club': 'theClubLower',
  'A player': 'aPlayer',
  'a player': 'aPlayerLower',
  'The player': 'thePlayer',
}

const PLAYER_FALLBACKS = new Set(['A player', 'a player', 'The player'])
const isPlayerFallback = (raw: string) => PLAYER_FALLBACKS.has(raw.trim())

/** A stored name, or the catalog word for the SQL's English fallback ("The player"). */
function nameOf(raw: string): string {
  const fallback = FALLBACK_NAMES[raw]
  return fallback ? tNotifications(`recruitingTitles.names.${fallback}` as 'recruitingTitles.names.aClub') : raw
}

export function recruitingTitle(event: string | null, stored: string): string {
  if (currentLanguage() === 'en' || !event) return stored
  for (const p of PATTERNS[event] ?? []) {
    const m = stored.trim().match(p.re)
    const raw = m?.[1]?.trim()
    if (raw) {
      // No member name (the SQL's "A player" / "The player"): a line without one reads better than "La persona…".
      if (isPlayerFallback(raw)) return tNotifications(`recruitingTitles.noName.${p.key}` as 'recruitingTitles.noName.offerSent')
      return tNotifications(`recruitingTitles.${p.key}` as 'recruitingTitles.offerSent', { name: nameOf(raw) })
    }
  }
  return stored
}

// ── The step lines the recruiting SQL posts into a chat ──────────────────
// _post_recruiting_card content (same migrations): one English line per step,
// read back by shape. The offer date is _recruiting_date_label ("2 Oct 2026").

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2 Oct 2026" in the active language's short date; anything else as stored. */
function dayOf(raw: string): string {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(raw.trim())
  const month = m ? MONTHS.indexOf(m[2]) : -1
  if (!m || month < 0) return raw
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1]))).toLocaleDateString(currentLanguage(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const role = (raw: string) => (raw.trim() === 'your role' ? tInbox('signing.serverLines.yourRole') : raw.trim())

/** One step line; the nameless wording when the SQL wrote its player fallback. */
function serverLine(key: string, rawName: string, vars: Record<string, string>): string {
  // Keys are built from the pattern table, so the typed key union can't follow them.
  const t = tInbox as unknown as (key: string, options: Record<string, string>) => string
  if (isPlayerFallback(rawName)) return t(`signing.serverLinesNoName.${key}`, vars)
  return t(`signing.serverLines.${key}`, { name: nameOf(rawName), ...vars })
}

const SERVER_LINES: { re: RegExp; line: (m: RegExpExecArray) => string }[] = [
  { re: /^(.+?) marked you as signed for (.+?)\. Confirm it on Hockia/, line: (m) => serverLine('markedYou', m[1], { role: role(m[2]) }) },
  {
    re: /^(.+?) (sent you an offer|updated its offer) for (.+?), open until (.+?)\. Open Hockia/,
    line: (m) => serverLine(m[2] === 'updated its offer' ? 'offerUpdated' : 'offerSent', m[1], { role: role(m[3]), day: dayOf(m[4]) }),
  },
  // The invite card adds the club's note and how to answer after its first line; the line alone is translated.
  { re: /^(.+?) invited you to apply for (.+?)\.(?:\n|$)/, line: (m) => serverLine('inviteFirstLine', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) confirmed the signing for (.+)\. Signed through Hockia\.$/, line: (m) => serverLine('signingConfirmed', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) undid the signing for (.+)\.$/, line: (m) => serverLine('signingUndone', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) withdrew its offer for (.+)\.$/, line: (m) => serverLine('offerWithdrawn', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) withdrew their application for (.+)\.$/, line: (m) => serverLine('applicationWithdrawn', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) accepted the offer for (.+)\.$/, line: (m) => serverLine('offerAccepted', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) declined the offer for (.+)\.$/, line: (m) => serverLine('offerDeclined', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) applied for (.+)\.$/, line: (m) => serverLine('applied', m[1], { role: role(m[2]) }) },
  { re: /^(.+?) passed on (.+)\.$/, line: (m) => serverLine('passedOn', m[1], { role: role(m[2]) }) },
]

/** A recruiting step line in the active language; English and unrecognised lines as stored. */
export function recruitingServerLine(content: string): string {
  if (currentLanguage() === 'en') return content
  for (const { re, line } of SERVER_LINES) {
    const m = re.exec(content)
    if (m) return line(m)
  }
  return content
}
