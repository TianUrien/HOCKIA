// deno-lint-ignore-file no-explicit-any
// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'

/**
 * Resend Webhook Handler
 *
 * Receives delivery events from Resend and updates the email_sends table.
 * Events: delivered, opened, clicked, bounced, complained
 *
 * Resend uses Svix for webhook signing. The RESEND_WEBHOOK_SECRET env var
 * contains the signing secret from the Resend dashboard.
 *
 * This function:
 *   1. Verifies the webhook signature (mandatory)
 *   2. Looks up the email_sends row by resend_email_id
 *   3. Updates the status with progression logic (never regresses)
 *   4. Inserts a raw event into email_events
 *   5. Always returns 200 (idempotent)
 */

// Map Resend event types to our event_type values
const EVENT_TYPE_MAP: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.unsubscribed': 'unsubscribed',
}

// Status priority for progression (higher = more significant)
const STATUS_PRIORITY: Record<string, number> = {
  'sent': 0,
  'delivered': 1,
  'opened': 2,
  'clicked': 3,
  'bounced': 10,   // Override
  'complained': 11, // Override
  'unsubscribed': 12,
}

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, svix-id, svix-timestamp, svix-signature',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const correlationId = crypto.randomUUID().slice(0, 8)
  const log = (level: string, msg: string, meta?: Record<string, unknown>) =>
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      `[RESEND-WEBHOOK][${correlationId}] ${msg}`, meta ?? ''
    )

  try {
    const rawBody = await req.text()
    let payload: any

    // ========================================================================
    // Verify webhook signature (mandatory)
    // ========================================================================
    const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
    if (!webhookSecret) {
      log('error', 'RESEND_WEBHOOK_SECRET not configured — refusing to process unverified webhooks')
      return new Response('Server misconfiguration', { status: 500 })
    }

    const svixId = req.headers.get('svix-id')
    const svixTimestamp = req.headers.get('svix-timestamp')
    const svixSignature = req.headers.get('svix-signature')

    if (!svixId || !svixTimestamp || !svixSignature) {
      log('warn', 'Missing svix headers, rejecting')
      return new Response('Missing signature headers', { status: 401 })
    }

    // Verify timestamp is within 5 minutes
    const timestampSec = parseInt(svixTimestamp, 10)
    const nowSec = Math.floor(Date.now() / 1000)
    if (Math.abs(nowSec - timestampSec) > 300) {
      log('warn', 'Webhook timestamp too old', { age: nowSec - timestampSec })
      return new Response('Timestamp too old', { status: 401 })
    }

    // Verify signature using HMAC-SHA256
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
    const secretBytes = base64Decode(webhookSecret.replace('whsec_', ''))
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
    const expectedSignature = `v1,${base64Encode(new Uint8Array(signatureBytes))}`

    // Svix can send multiple signatures separated by spaces
    const signatures = svixSignature.split(' ')
    const isValid = signatures.some(sig => sig === expectedSignature)

    if (!isValid) {
      log('warn', 'Invalid webhook signature')
      return new Response('Invalid signature', { status: 401 })
    }

    log('info', 'Webhook signature verified')

    payload = JSON.parse(rawBody)

    // ========================================================================
    // Parse event
    // ========================================================================
    const eventType = EVENT_TYPE_MAP[payload.type]
    if (!eventType) {
      log('info', 'Ignoring unhandled event type', { type: payload.type })
      return new Response('OK', { status: 200 })
    }

    const data = payload.data
    const resendEmailId = data?.email_id
    if (!resendEmailId) {
      log('warn', 'No email_id in webhook payload', { type: payload.type })
      return new Response('OK', { status: 200 })
    }

    log('info', 'Processing webhook event', {
      eventType,
      resendEmailId,
      to: data.to?.[0],
    })

    // ========================================================================
    // Connect to Supabase (service role for bypassing RLS)
    // ========================================================================
    const supabase = getServiceClient()

    // ========================================================================
    // Look up the email_sends row
    // ========================================================================
    const { data: sendRow, error: lookupError } = await supabase
      .from('email_sends')
      .select('id, status, delivered_at, opened_at, clicked_at, bounced_at')
      .eq('resend_email_id', resendEmailId)
      .maybeSingle()

    if (lookupError) {
      log('error', 'Failed to look up email_sends', { error: lookupError.message })
    }

    // ========================================================================
    // Update email_sends status (with progression logic)
    // ========================================================================
    if (sendRow) {
      const currentPriority = STATUS_PRIORITY[sendRow.status] ?? 0
      const newPriority = STATUS_PRIORITY[eventType] ?? 0

      // Only progress forward (or override with bounce/complaint)
      if (newPriority > currentPriority) {
        const updates: Record<string, any> = { status: eventType }

        // Set timestamp columns
        if (eventType === 'delivered' && !sendRow.delivered_at) {
          updates.delivered_at = data.created_at || new Date().toISOString()
        }
        if (eventType === 'opened') {
          updates.opened_at = data.created_at || new Date().toISOString()
          // Also set delivered_at if not already set
          if (!sendRow.delivered_at) {
            updates.delivered_at = data.created_at || new Date().toISOString()
          }
        }
        if (eventType === 'clicked') {
          updates.clicked_at = data.created_at || new Date().toISOString()
          if (!sendRow.opened_at) {
            updates.opened_at = data.created_at || new Date().toISOString()
          }
          if (!sendRow.delivered_at) {
            updates.delivered_at = data.created_at || new Date().toISOString()
          }
        }
        if (eventType === 'bounced') {
          updates.bounced_at = data.created_at || new Date().toISOString()
        }

        const { error: updateError } = await supabase
          .from('email_sends')
          .update(updates)
          .eq('id', sendRow.id)

        if (updateError) {
          log('error', 'Failed to update email_sends', { error: updateError.message, sendId: sendRow.id })
        } else {
          log('info', 'Updated email_sends status', { sendId: sendRow.id, from: sendRow.status, to: eventType })
        }
      } else {
        log('info', 'Skipping status update (no progression)', {
          sendId: sendRow.id,
          current: sendRow.status,
          event: eventType,
        })
      }
    } else {
      log('info', 'No matching email_sends row found', { resendEmailId })
    }

    // ========================================================================
    // Insert raw event into email_events
    // ========================================================================
    const { error: eventError } = await supabase
      .from('email_events')
      .insert({
        send_id: sendRow?.id || null,
        resend_email_id: resendEmailId,
        event_type: eventType,
        url: data.click?.url || null,
        raw_payload: payload,
        occurred_at: data.created_at || new Date().toISOString(),
      })

    if (eventError) {
      log('error', 'Failed to insert email_events', { error: eventError.message })
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    log('error', 'Webhook handler error', {
      error: error instanceof Error ? error.message : 'Unknown',
    })
    captureException(error, { functionName: 'resend-webhook', correlationId })
    // Always return 200 to prevent Resend from retrying
    return new Response('OK', { status: 200 })
  }
})

// ============================================================================
// Base64 helpers (for Svix signature verification)
// ============================================================================

function base64Decode(str: string): Uint8Array {
  const binaryStr = atob(str)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
