// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Email Template Rendering Pipeline
 *
 * Fetches structured templates from the database (email_templates table),
 * renders content_json blocks into full HTML emails with the HOCKIA brand
 * layout, and interpolates personalization variables.
 *
 * Block types supported:
 *   heading, paragraph, card, user_card, button, divider,
 *   footnote, note, conversation_list
 */

// @ts-expect-error Deno URL imports are resolved at runtime in Supabase Edge Functions.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

// ============================================================================
// Types
// ============================================================================

export interface EmailTemplate {
  id: string
  template_key: string
  name: string
  subject_template: string
  content_json: ContentBlock[]
  text_template: string | null
  variables: TemplateVariable[]
  is_active: boolean
}

export interface ContentBlock {
  type: string
  text?: string
  level?: number
  url?: string
  title?: string
  subtitle?: string
  label?: string
  fields?: Array<{ label: string; value: string; conditional?: boolean }>
  // user_card specific
  name_var?: string
  avatar_var?: string
  detail_vars?: string[]
  // note block
  // conversation_list
  conversations_var?: string
  // paragraph modifiers
  is_html?: boolean
  align?: string
  size?: string
  color?: string
  // conditional rendering
  conditional?: boolean
}

export interface TemplateVariable {
  name: string
  description: string
  required: boolean
}

export interface ConversationData {
  conversation_id: string
  message_count: number
  sender_name: string
  sender_avatar_url: string | null
}

// ============================================================================
// Template Fetching
// ============================================================================

/**
 * Fetch the active template by key from the database.
 * Returns null if not found or not active.
 */
export async function getActiveTemplate(
  supabase: SupabaseClient,
  templateKey: string
): Promise<EmailTemplate | null> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, template_key, name, subject_template, content_json, text_template, variables, is_active')
    .eq('template_key', templateKey)
    .eq('is_active', true)
    .single()

  if (error || !data) return null
  return data as EmailTemplate
}

// ============================================================================
// Variable Interpolation
// ============================================================================

/**
 * Replace {{variable}} placeholders in a string with provided values.
 * Unresolved variables are left as-is (empty string for optional vars).
 */
export function interpolateVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return variables[varName] ?? ''
  })
}

/**
 * Validate that all required variables are provided.
 */
export function validateVariables(
  templateVars: TemplateVariable[],
  providedVars: Record<string, string>
): { valid: boolean; missing: string[] } {
  const missing = templateVars
    .filter(v => v.required && (!providedVars[v.name] || providedVars[v.name].trim() === ''))
    .map(v => v.name)

  return { valid: missing.length === 0, missing }
}

// ============================================================================
// HTML Rendering — Block-by-Block
// ============================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function renderAvatarHtml(avatarUrl: string | null, name: string, size = 48): string {
  if (avatarUrl) {
    const r = Math.floor(size / 2)
    return `<img src="${avatarUrl}" alt="${escapeHtml(name)}" style="width: ${size}px; height: ${size}px; border-radius: ${r}px;" />`
  }
  const initials = getInitials(name)
  const r = Math.floor(size / 2)
  const fontSize = size > 40 ? 16 : 14
  return `<table cellpadding="0" cellspacing="0" border="0" style="width: ${size}px; height: ${size}px; border-radius: ${r}px; background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%);">
    <tr>
      <td align="center" valign="middle" style="width: ${size}px; height: ${size}px; color: white; font-weight: bold; font-size: ${fontSize}px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${initials}</td>
    </tr>
  </table>`
}

function renderPill(text: string): string {
  return `<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-right: 8px; margin-bottom: 8px;">${escapeHtml(text)}</span>`
}

function renderBlock(block: ContentBlock, vars: Record<string, string>): string {
  const interpolate = (s: string | undefined) => s ? interpolateVariables(s, vars) : ''

  switch (block.type) {
    case 'heading': {
      const text = interpolate(block.text)
      if (!text) return ''
      const tag = block.level === 2 ? 'h2' : 'h1'
      const fontSize = block.level === 2 ? '20px' : '24px'
      return `<${tag} style="color: #1f2937; margin: 0 0 8px 0; font-size: ${fontSize}; font-weight: 700;">${text}</${tag}>`
    }

    case 'paragraph': {
      const text = interpolate(block.text)
      if (!text && block.conditional) return ''
      const align = block.align || 'left'
      const fontSize = block.size === 'small' ? '13px' : '16px'
      const color = block.color === 'muted' ? '#9ca3af' : '#6b7280'
      // Allow controlled HTML for links
      const content = block.is_html ? text : escapeHtml(text)
      return `<p style="color: ${color}; margin: 0 0 24px 0; font-size: ${fontSize}; text-align: ${align};">${content}</p>`
    }

    case 'card': {
      const title = interpolate(block.title)
      const subtitle = interpolate(block.subtitle)
      const label = interpolate(block.label)
      const fields = (block.fields || [])
        .map(f => {
          const val = interpolate(f.value)
          if (f.conditional && !val) return ''
          return renderPill(val ? `${f.label ? f.label + ': ' : ''}${val}` : f.label || '')
        })
        .filter(Boolean)
        .join('')

      return `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;">
      ${label ? `<p style="color: #6b7280; margin: 0 0 4px 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(label)}</p>` : ''}
      ${title ? `<h2 style="color: #1f2937; margin: 0 0 4px 0; font-size: 20px; font-weight: 600;">${escapeHtml(title)}</h2>` : ''}
      ${subtitle ? `<p style="color: #8026FA; margin: 0 0 16px 0; font-size: 15px; font-weight: 500;">${escapeHtml(subtitle)}</p>` : ''}
      ${fields ? `<div style="margin-top: 8px;">${fields}</div>` : ''}
    </div>`
    }

    case 'user_card': {
      const name = interpolate(block.name_var ? `{{${block.name_var}}}` : '') || 'User'
      const avatarUrl = vars[block.avatar_var || ''] || null
      const label = interpolate(block.label)
      const detailPills = (block.detail_vars || [])
        .map(v => {
          const val = vars[v] || ''
          return val ? renderPill(val) : ''
        })
        .filter(Boolean)
        .join('')

      const avatarHtml = renderAvatarHtml(avatarUrl, name)

      return `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
      ${label ? `<p style="color: #6b7280; margin: 0 0 12px 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(label)}</p>` : ''}
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="56" valign="top">
            ${avatarHtml}
          </td>
          <td style="padding-left: 12px;" valign="middle">
            <p style="color: #1f2937; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">${escapeHtml(name)}</p>
            ${detailPills ? `<div>${detailPills}</div>` : ''}
          </td>
        </tr>
      </table>
    </div>`
    }

    case 'note': {
      const text = interpolate(block.text)
      if (!text && block.conditional) return ''
      if (!text) return ''
      const label = interpolate(block.label)
      return `
    <div style="background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin-top: -12px; margin-bottom: 24px;">
      ${label ? `<p style="color: #92400e; margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(label)}</p>` : ''}
      <p style="color: #78350f; margin: 0; font-size: 14px; line-height: 1.5;">${escapeHtml(text)}</p>
    </div>`
    }

    case 'button': {
      const text = interpolate(block.text) || 'Learn More'
      const url = interpolate(block.url)
      if (!url) return ''
      return `
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${url}" style="display: inline-block; background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); color: #ffffff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;">
        ${escapeHtml(text)}
      </a>
    </div>`
    }

    case 'divider':
      return `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />`

    case 'footnote': {
      const text = interpolate(block.text)
      if (!text) return ''
      return `<p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0 0; text-align: center;">${escapeHtml(text)}</p>`
    }

    case 'conversation_list': {
      // Expects vars to contain the conversations as a JSON string
      const convVar = block.conversations_var || 'conversations'
      const convJson = vars[convVar]
      if (!convJson) return ''

      let conversations: ConversationData[]
      try {
        conversations = JSON.parse(convJson)
      } catch {
        return ''
      }

      const cards = conversations.map(conv => {
        const avatar = renderAvatarHtml(conv.sender_avatar_url, conv.sender_name, 40)
        const messageLabel = conv.message_count === 1
          ? '1 new message'
          : `${conv.message_count} new messages`

        return `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; margin-bottom: 8px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="48" valign="middle">
            ${avatar}
          </td>
          <td style="padding-left: 12px;" valign="middle">
            <p style="color: #1f2937; margin: 0; font-size: 16px; font-weight: 600;">${escapeHtml(conv.sender_name)}</p>
            <p style="color: #6b7280; margin: 2px 0 0 0; font-size: 14px;">${messageLabel}</p>
          </td>
        </tr>
      </table>
    </div>`
      }).join('\n')

      return `<div style="margin-bottom: 24px;">${cards}</div>`
    }

    default:
      return ''
  }
}

// ============================================================================
// Full Email Rendering
// ============================================================================

/**
 * Render content_json blocks into a complete HOCKIA-branded HTML email.
 */
export function renderContentBlocks(
  blocks: ContentBlock[],
  variables: Record<string, string>,
  options?: { isOutreach?: boolean }
): { html: string; text: string | null } {
  const bodyContent = blocks
    .map(block => renderBlock(block, variables))
    .filter(Boolean)
    .join('\n    ')

  const settingsUrl = variables.settings_url || `${HOCKIA_BASE_URL}/settings`
  const isOutreach = options?.isOutreach ?? false

  const footerHtml = isOutreach
    ? `<p style="color: #9ca3af; font-size: 12px; margin: 0;">
      You received this email because we believe your organization may benefit from HOCKIA.<br>
      <a href="https://inhockia.com" style="color: #8026FA; text-decoration: none;">Learn more about HOCKIA</a>
    </p>`
    : `<p style="color: #9ca3af; font-size: 12px; margin: 0;">
      You're receiving this because you're on HOCKIA.<br>
      <a href="${settingsUrl}" style="color: #8026FA; text-decoration: none;">Manage notification preferences</a>
    </p>`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">

  <!-- Header -->
  <div style="background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
    <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="120" height="29" style="height: 29px; width: 120px;" />
  </div>

  <!-- Main Content -->
  <div style="background: #ffffff; padding: 32px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
    ${bodyContent}
  </div>

  <!-- Footer -->
  <div style="background: #f3f4f6; padding: 20px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
    ${footerHtml}
  </div>

</body>
</html>`.trim()

  return { html, text: null }
}

/**
 * Full render pipeline: fetch template, validate variables, render HTML + interpolate text.
 * Returns null if template not found or not active.
 */
export async function renderTemplate(
  supabase: SupabaseClient,
  templateKey: string,
  variables: Record<string, string>
): Promise<{ subject: string; html: string; text: string } | null> {
  const template = await getActiveTemplate(supabase, templateKey)
  if (!template) return null

  // Add settings_url if not provided
  if (!variables.settings_url) {
    variables.settings_url = `${HOCKIA_BASE_URL}/settings`
  }

  const isOutreach = template.template_key.startsWith('outreach_')
  const subject = interpolateVariables(template.subject_template, variables)
  const { html } = renderContentBlocks(template.content_json, variables, { isOutreach })
  const text = template.text_template
    ? interpolateVariables(template.text_template, variables)
    : subject // Fallback plain text is just the subject

  return { subject, html, text }
}
