// deno-lint-ignore-file no-explicit-any
// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail, createLogger } from '../_shared/email-sender.ts'

/**
 * Admin Send Test Email
 *
 * Allows admins to send a test email using a specific template
 * with provided test variables. Used from the Admin Email Template Editor.
 *
 * Request body:
 *   template_id: UUID - the template to test
 *   recipient_email: string - where to send the test
 *   test_variables: Record<string, string> - variable overrides
 *
 * Security: Validates JWT and checks is_platform_admin()
 */

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const headers = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers })
  }

  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('ADMIN-TEST-EMAIL', correlationId)

  try {
    // ========================================================================
    // Auth check
    // ========================================================================
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Create user-context client for auth check
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Check admin status
    const { data: isAdmin } = await userClient.rpc('is_platform_admin')
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin access required' }),
        { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================================================
    // Parse request
    // ========================================================================
    const body = await req.json()
    const { template_id, recipient_email, test_variables } = body

    if (!template_id || !recipient_email) {
      return new Response(
        JSON.stringify({ success: false, error: 'template_id and recipient_email are required' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Sending test email', {
      templateId: template_id,
      recipientEmail: recipient_email,
      adminId: user.id,
    })

    // ========================================================================
    // Load template
    // ========================================================================
    // Use service role client for DB operations (bypasses RLS)
    const serviceClient = getServiceClient()

    const { data: template, error: templateError } = await serviceClient
      .from('email_templates')
      .select('template_key, subject_template, content_json, text_template, variables')
      .eq('id', template_id)
      .single()

    if (templateError || !template) {
      return new Response(
        JSON.stringify({ success: false, error: 'Template not found' }),
        { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================================================
    // Render and send
    // ========================================================================
    const rendered = await renderTemplate(serviceClient, template.template_key, test_variables || {})
    if (!rendered) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to render template' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const result = await sendTrackedEmail({
      supabase: serviceClient,
      resendApiKey,
      to: recipient_email,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      templateKey: template.template_key,
      logger,
      isTest: true,
    })

    if (!result.success) {
      return new Response(
        JSON.stringify({ success: false, error: result.error || 'Failed to send' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Test email sent', { resendEmailId: result.resendEmailId })

    return new Response(
      JSON.stringify({ success: true, resend_email_id: result.resendEmailId }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    logger.error('Test email handler error', {
      error: error instanceof Error ? error.message : 'Unknown',
    })
    captureException(error, { functionName: 'admin-send-test-email', correlationId })
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }
})
