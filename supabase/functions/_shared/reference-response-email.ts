// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }
import { escapeHtml } from './html-escape.ts'
import { EMAIL_LOGO_HTML, emailAvatarHtml } from './email-brand.ts'
import { type MemberLanguage, FOOTER_ES, relationshipLabel } from './member-language.ts'

/**
 * Reference Response Email Helpers
 *
 * Used by the notify-reference-response Edge Function.
 *
 * Sent when: a pending reference request is ACCEPTED (declines stay in-app
 * only — see B1 fix scope notes). The recipient is the original requester
 * (the person whose ask was answered with a yes).
 *
 * Email shape mirrors reference-request-email.ts so the visual + textual
 * convention stays consistent across the trust-feature emails. CTA points
 * to the requester's own profile reference carousel so they can see the
 * new endorsement live.
 */

export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
export const UNSUBSCRIBE_URL = `${HOCKIA_BASE_URL}/settings`

export interface ReferenceRecord {
  id: string
  requester_id: string
  reference_id: string
  status: string
  relationship_type: string
  request_note: string | null
  endorsement_text: string | null
  accepted_at: string | null
}

export interface ReferenceResponsePayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: 'profile_references'
  schema: 'public'
  record: ReferenceRecord
  old_record: ReferenceRecord | null
}

export interface EndorserData {
  id: string
  username: string | null
  full_name: string | null
  avatar_url: string | null
  is_test_account: boolean
  /** 'player' | 'coach' | 'club' | 'brand' | 'umpire' — determines the
   * public profile path used by the "view their profile" link in the email. */
  role: string | null
}

export interface RecipientData {
  id: string
  email: string
  full_name: string | null
  is_test_account: boolean
  notify_references: boolean
  onboarding_completed: boolean
}

/** Map any role to the correct public profile path. References can be given
 *  by any role (clubs and brands too, per the references domain model), so
 *  we have to handle all five role buckets. */
export function buildEndorserProfileUrl(
  endorser: Pick<EndorserData, 'id' | 'username' | 'role'>,
  baseUrl: string,
): string {
  let slug = 'players'
  if (endorser.role === 'umpire') slug = 'umpires'
  else if (endorser.role === 'club') slug = 'clubs'
  else if (endorser.role === 'brand') slug = 'brands'
  return endorser.username
    ? `${baseUrl}/${slug}/${endorser.username}`
    : `${baseUrl}/${slug}/id/${endorser.id}`
}


const REFERENCE_NO_TEXT_ES = 'No agregó un texto, pero la referencia ya se ve en tu perfil.'
const REFERENCE_FOOTER_ES = 'Este email te llega porque alguien te dio una referencia en Hockia.'

/** Subject when the DB template is unavailable. */
export function referenceAcceptedSubject(endorserName: string, language: MemberLanguage = 'en'): string {
  return language === 'es'
    ? `${endorserName} te dio una referencia en Hockia`
    : `${endorserName} vouched for you on Hockia`
}

/** Excerpt the endorsement to a sane preview length. The DB CHECK now
 *  caps endorsement_text at 800 chars (post-Phase 4 references-bug-bundle
 *  migration), so most will fit without trimming. Anything longer reads
 *  better as a "click through to read it" preview. */
function endorsementPreview(text: string | null, maxChars = 280): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, maxChars).replace(/\s+\S*$/, '').trim() + '…'
}

export function generateAcceptedEmailHtml(
  endorser: EndorserData,
  relationshipTypeRaw: string,
  endorsementText: string | null,
  language: MemberLanguage = 'en',
): string {
  const es = language === 'es'
  const relationshipType = es ? relationshipLabel(relationshipTypeRaw, language) : relationshipTypeRaw
  const displayName = endorser.full_name?.trim() || (es ? 'Alguien de Hockia' : 'A Hockia member')
  const profileUrl = buildEndorserProfileUrl(endorser, HOCKIA_BASE_URL)

  const avatarHtml = emailAvatarHtml(endorser.avatar_url, displayName, endorser.role)

  const preview = endorsementPreview(endorsementText)
  const endorsementHtml = preview
    ? `
    <div style="background: #fbf4dc; border: 1px solid #c9a227; border-radius: 8px; padding: 12px 16px; margin-top: 12px;">
      <p style="color: #8a6300; margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${es ? `Lo que escribió ${escapeHtml(displayName)}` : `What ${escapeHtml(displayName)} wrote`}</p>
      <p style="color: #8a6300; margin: 0; font-size: 14px; line-height: 1.5;">${escapeHtml(preview)}</p>
    </div>`
    : `
    <p style="color: #6b6878; margin: 12px 0 0 0; font-size: 14px;">${es ? REFERENCE_NO_TEXT_ES : "They didn't add a written endorsement, but the trust signal is live on your profile."}</p>`

  const relationshipPill = relationshipType
    ? `<span style="display: inline-block; background: #f1eff6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #3f3c4d; margin-right: 8px; margin-bottom: 8px;">${escapeHtml(relationshipType)}</span>`
    : ''

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

    <h1 style="color: #0e0b1a; margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">${escapeHtml(displayName)} ${es ? 'te dio una referencia en Hockia' : 'vouched for you on Hockia'}</h1>
    <p style="color: #6b6878; margin: 0 0 24px 0; font-size: 16px;">${es ? 'Su referencia ya se ve en tu perfil.' : 'Their reference is now live on your profile.'}</p>

    <div style="background: #fbfafd; border: 1px solid #e6e3ee; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="56" valign="top">
            ${avatarHtml}
          </td>
          <td style="padding-left: 12px;" valign="middle">
            <p style="color: #0e0b1a; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">${escapeHtml(displayName)}</p>
            <div>${relationshipPill}</div>
          </td>
        </tr>
      </table>
      ${endorsementHtml}
    </div>

    <p style="margin: 0 0 8px 0;">
      <a href="${HOCKIA_BASE_URL}/dashboard/profile/references" style="color: #6c2bd9; font-weight: 600; text-decoration: none;">${es ? 'Ver en tu perfil' : 'See it on your profile'} &rarr;</a>
    </p>

    <p style="color: #73707c; font-size: 14px; margin: 0;">
      <a href="${escapeHtml(profileUrl)}" style="color: #6c2bd9; text-decoration: none;">${es ? `Ver el perfil de ${escapeHtml(displayName)}` : `View ${escapeHtml(displayName)}'s profile`}</a>
    </p>
  </div>

  <div style="border-top: 1px solid #e6e3ee; padding: 16px 0 0 0; text-align: left;">
    <p style="color: #73707c; font-size: 12px; margin: 0;">
      ${es ? REFERENCE_FOOTER_ES : "You're receiving this because someone vouched for you on Hockia."}<br>
      <a href="${UNSUBSCRIBE_URL}" style="color: #6c2bd9; text-decoration: none;">${es ? FOOTER_ES.settings : 'Notification settings'}</a>
    </p>
  </div>

</body>
</html>`
}

export function generateAcceptedEmailText(
  endorser: EndorserData,
  relationshipTypeRaw: string,
  endorsementText: string | null,
  language: MemberLanguage = 'en',
): string {
  const es = language === 'es'
  const relationshipType = es ? relationshipLabel(relationshipTypeRaw, language) : relationshipTypeRaw
  const displayName = endorser.full_name?.trim() || (es ? 'Alguien de Hockia' : 'A Hockia member')
  const profileUrl = buildEndorserProfileUrl(endorser, HOCKIA_BASE_URL)
  const preview = endorsementPreview(endorsementText)

  const lines = [
    es ? `${displayName} te dio una referencia en Hockia` : `${displayName} vouched for you on Hockia`,
    '',
    es ? 'Su referencia ya se ve en tu perfil.' : `Their reference is now live on your profile.`,
  ]

  if (relationshipType) {
    lines.push(`${es ? 'Relación' : 'Relationship'}: ${relationshipType}`)
  }

  if (preview) {
    lines.push('', es ? 'Lo que escribió:' : `What they wrote:`, `"${preview}"`)
  } else {
    lines.push('', es ? REFERENCE_NO_TEXT_ES : `They didn't add a written endorsement, but the trust signal is live on your profile.`)
  }

  lines.push(
    '',
    es ? 'Ver en tu perfil:' : 'See it on your profile:',
    `${HOCKIA_BASE_URL}/dashboard/profile/references`,
    '',
    es ? `Ver el perfil de ${displayName}:` : `View ${displayName}'s profile:`,
    profileUrl,
    '',
    '---',
    es ? REFERENCE_FOOTER_ES : "You're receiving this because someone vouched for you on Hockia.",
    `${es ? FOOTER_ES.manage : 'Manage preferences: '}${UNSUBSCRIBE_URL}`,
  )

  return lines.join('\n')
}

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
}

export function createLogger(prefix: string, correlationId: string): Logger {
  return {
    info: (message: string, meta?: Record<string, unknown>) =>
      console.log(`[${prefix}][${correlationId}] ${message}`, meta ?? ''),
    warn: (message: string, meta?: Record<string, unknown>) =>
      console.warn(`[${prefix}][${correlationId}] ${message}`, meta ?? ''),
    error: (message: string, meta?: Record<string, unknown>) =>
      console.error(`[${prefix}][${correlationId}] ${message}`, meta ?? ''),
  }
}
