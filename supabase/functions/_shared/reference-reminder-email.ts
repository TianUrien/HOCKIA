// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }
import { escapeHtml } from './html-escape.ts'
import { EMAIL_LOGO_HTML, emailAvatarHtml } from './email-brand.ts'
import { type MemberLanguage, FOOTER_ES } from './member-language.ts'

/**
 * Reference Reminder Email Helpers (Phase 3.2)
 *
 * Used by the notify-reference-reminder Edge Function.
 *
 * Sent when: a user has had at least one accepted friendship for ≥7 days
 * but still has zero references (no accepted, no pending). One-time per
 * user, per the queue's UNIQUE(recipient_id) constraint.
 *
 * Visual style mirrors reference-request-email.ts and
 * reference-response-email.ts so the trust-feature emails look like a
 * coherent family (same logo block, same card layout, same emerald
 * accent for trust-positive moments).
 */

export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
export const UNSUBSCRIBE_URL = `${HOCKIA_BASE_URL}/settings`

export interface ReminderRecipient {
  id: string
  email: string
  full_name: string | null
  username: string | null
}

export interface ReminderSuggestedFriend {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  role: string | null
}


/**
 * Recipient first-name extraction. Falls back to "there" if both full_name
 * and username are null — the email body still reads naturally
 * ("Hi there,").
 */
export function recipientFirstName(
  recipient: Pick<ReminderRecipient, 'full_name' | 'username'>,
  language: MemberLanguage = 'en',
): string {
  const fromFullName = recipient.full_name?.split(' ')[0]?.trim()
  if (fromFullName) return fromFullName
  const fromUsername = recipient.username?.trim()
  if (fromUsername) return fromUsername
  return language === 'es' ? 'integrante' : 'there'
}

/** Subject (and heading) of the reminder. */
export function reminderSubject(language: MemberLanguage = 'en'): string {
  return language === 'es' ? 'Sumar confianza a tu perfil de Hockia' : 'Add trust to your Hockia profile'
}

/**
 * Display name for the suggested friend. Falls back to "a connection" so
 * we never email "Ask <blank> for a reference" — the same orphan-profile
 * defense the in-app RecentlyConnectedCard uses, but tighter (the friend
 * candidate is already filtered to non-orphans at enqueue time, so this
 * is belt-and-braces).
 */
export function friendDisplayName(
  friend: Pick<ReminderSuggestedFriend, 'full_name' | 'username'>,
  language: MemberLanguage = 'en',
): string {
  const cleaned = friend.full_name?.trim() || friend.username?.trim()
  return cleaned || (language === 'es' ? 'una conexión' : 'a connection')
}

export function friendFirstName(
  friend: Pick<ReminderSuggestedFriend, 'full_name' | 'username'>,
  language: MemberLanguage = 'en',
): string {
  const display = friendDisplayName(friend, language)
  if (!(friend.full_name?.trim() || friend.username?.trim())) return display
  return display.split(' ')[0]?.trim() || display
}

/**
 * Build the deeplink that the email CTA opens. Lands the user on the
 * Profile tab of their dashboard with the references area pre-scrolled
 * AND the AddReferenceModal pre-selected to the suggested friend (the
 * `?ask=<id>` param is consumed by FriendsTab and stripped on first
 * read so a refresh doesn't re-open the modal).
 *
 * The same deeplink format is used by the in-app RecentlyConnectedCard
 * — see PlayerDashboard.tsx onAsk handler. Keeping these in lockstep
 * avoids URL drift between in-app and email surfaces.
 */
const REMINDER_BODY_ES =
  'Las referencias son avales breves de cuerpos técnicos, compañeros/as de equipo y clubes con quienes hay conexión en Hockia. Aparecen en tu perfil y dan más confianza sobre tu trayectoria a los clubes y cuerpos técnicos que buscan talento en Hockia.'
const REMINDER_ONE_ES = 'Una sola referencia suele marcar la diferencia, y pedirla lleva más o menos un minuto.'
const REMINDER_FOOTER_ES = 'Este email te llega porque los avisos por email de referencias están activados en tu cuenta de Hockia.'

export function buildReminderCtaUrl(
  baseUrl: string,
  suggestedFriendId: string,
): string {
  const u = new URL(`${baseUrl}/dashboard/profile`)
  u.searchParams.set('tab', 'friends')
  u.searchParams.set('section', 'references')
  u.searchParams.set('ask', suggestedFriendId)
  return u.toString()
}

export function generateReminderEmailHtml(
  recipient: ReminderRecipient,
  friend: ReminderSuggestedFriend,
  language: MemberLanguage = 'en',
): string {
  const es = language === 'es'
  const firstName = recipientFirstName(recipient, language)
  const friendName = friendDisplayName(friend, language)
  const friendFirst = friendFirstName(friend, language)
  const ctaUrl = buildReminderCtaUrl(HOCKIA_BASE_URL, friend.id)

  const avatarHtml = emailAvatarHtml(friend.avatar_url, friendName, friend.role)

  return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #0e0b1a; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="padding: 16px 0 24px 0; text-align: left;">
    ${EMAIL_LOGO_HTML}
  </div>

  <div style="padding: 0 0 24px 0;">

    <h1 style="color: #0e0b1a; margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">${reminderSubject(language)}</h1>
    <p style="color: #6b6878; margin: 0 0 24px 0; font-size: 16px;">${es
      ? `Hola, ${escapeHtml(firstName)}. ${escapeHtml(friendFirst)} es parte de tus conexiones en Hockia y puede dar una referencia sobre tu juego.`
      : `Hi ${escapeHtml(firstName)}, you're connected with ${escapeHtml(friendFirst)} on Hockia. They could vouch for your hockey.`}</p>

    <div style="background: #fbfafd; border: 1px solid #e6e3ee; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="56" valign="top">
            ${avatarHtml}
          </td>
          <td style="padding-left: 12px;" valign="middle">
            <p style="color: #0e0b1a; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">${escapeHtml(friendName)}</p>
            <p style="color: #6b6878; margin: 0; font-size: 14px;">${es ? 'Una conexión de Hockia' : 'A Hockia connection'}</p>
          </td>
        </tr>
      </table>
    </div>

    <p style="color: #3f3c4d; margin: 0 0 16px 0; font-size: 15px; line-height: 1.6;">
      ${es ? REMINDER_BODY_ES : "References are short vouches from coaches, teammates and clubs you've connected with on Hockia. They appear on your profile and give the clubs and coaches scouting on Hockia more confidence in your background."}
    </p>

    <p style="color: #3f3c4d; margin: 0 0 24px 0; font-size: 15px; line-height: 1.6;">
      ${es ? REMINDER_ONE_ES : 'One reference is usually enough to make a difference, and asking takes about a minute.'}
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${escapeHtml(ctaUrl)}"
         style="display: inline-block; background: #7c3aed; color: white; padding: 14px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 15px;">
        ${es ? `Pedirle una referencia a ${escapeHtml(friendFirst)}` : `Ask ${escapeHtml(friendFirst)} for a reference`}
      </a>
    </div>

  </div>

  <hr style="border: none; border-top: 1px solid #e6e3ee; margin: 32px 0 16px 0;">

  <p style="color: #73707c; font-size: 12px; line-height: 1.5; margin: 0 0 8px 0;">
    ${es ? REMINDER_FOOTER_ES : "You're receiving this because you have email notifications turned on for references on Hockia."}
    <a href="${escapeHtml(UNSUBSCRIBE_URL)}" style="color: #6b6878; text-decoration: underline;">${es ? FOOTER_ES.settings : 'Manage email preferences'}</a>.
  </p>

</body>
</html>`
}

export function generateReminderEmailText(
  recipient: ReminderRecipient,
  friend: ReminderSuggestedFriend,
  language: MemberLanguage = 'en',
): string {
  const es = language === 'es'
  const firstName = recipientFirstName(recipient, language)
  const friendName = friendDisplayName(friend, language)
  const friendFirst = friendFirstName(friend, language)
  const ctaUrl = buildReminderCtaUrl(HOCKIA_BASE_URL, friend.id)

  if (es) {
    return [
      reminderSubject(language),
      '',
      `Hola, ${firstName}:`,
      '',
      `${friendName} es parte de tus conexiones en Hockia y puede dar una referencia sobre tu juego.`,
      '',
      REMINDER_BODY_ES,
      '',
      REMINDER_ONE_ES,
      '',
      `Pedirle una referencia a ${friendFirst}:`,
      ctaUrl,
      '',
      '---',
      REMINDER_FOOTER_ES,
      `${FOOTER_ES.manage}${UNSUBSCRIBE_URL}`,
    ].join('\n')
  }

  return [
    'Add trust to your Hockia profile',
    '',
    `Hi ${firstName},`,
    '',
    `You're connected with ${friendName} on Hockia. They could vouch for your hockey.`,
    '',
    'References are short vouches from coaches, teammates and clubs you\'ve connected with on Hockia. They appear on your profile and give the clubs and coaches scouting on Hockia more confidence in your background.',
    '',
    'One reference is usually enough to make a difference, and asking takes about a minute.',
    '',
    `Ask ${friendFirst} for a reference:`,
    ctaUrl,
    '',
    '---',
    'You\'re receiving this because you have email notifications turned on for references on Hockia.',
    `Manage email preferences: ${UNSUBSCRIBE_URL}`,
  ].join('\n')
}
