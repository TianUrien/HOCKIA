// deno-lint-ignore-file no-explicit-any
// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

// @ts-expect-error Deno URL imports are resolved at runtime in Supabase Edge Functions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { renderTemplate, getActiveTemplate, interpolateVariables, renderContentBlocks } from '../_shared/email-renderer.ts'
import { sendTrackedBatch, createLogger } from '../_shared/email-sender.ts'
import type { RecipientInfo } from '../_shared/email-sender.ts'

/**
 * Admin Send Campaign
 *
 * Sends an email campaign to the filtered audience.
 * Validates that the campaign is in 'draft' status, renders the template,
 * queries recipients based on audience_filter, and sends via batch API.
 *
 * Request body:
 *   campaign_id: UUID - the campaign to send
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
  const logger = createLogger('SEND-CAMPAIGN', correlationId)

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

    const { data: isAdmin } = await userClient.rpc('is_platform_admin')
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin access required' }),
        { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================================================
    // Rate limit: max 5 campaigns per admin per hour
    // ========================================================================
    const serviceClientForRateCheck = getServiceClient()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recentSends } = await serviceClientForRateCheck
      .from('email_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .in('status', ['sending', 'sent'])
      .gte('updated_at', oneHourAgo)

    if ((recentSends ?? 0) >= 5) {
      logger.warn('Campaign rate limit exceeded', { adminId: user.id, recentSends })
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit: max 5 campaigns per hour. Please wait before sending another.' }),
        { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================================================
    // Parse request
    // ========================================================================
    const body = await req.json()
    const { campaign_id } = body

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'campaign_id is required' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    const serviceClient = getServiceClient()

    // ========================================================================
    // Fetch campaign — must be 'draft'
    // ========================================================================
    const { data: campaign, error: campaignError } = await serviceClient
      .from('email_campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single()

    if (campaignError || !campaign) {
      return new Response(
        JSON.stringify({ success: false, error: 'Campaign not found' }),
        { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    if (campaign.status !== 'draft') {
      return new Response(
        JSON.stringify({ success: false, error: `Campaign is already "${campaign.status}", only draft campaigns can be sent` }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Starting campaign send', {
      campaignId: campaign_id,
      campaignName: campaign.name,
      templateKey: campaign.template_key,
      adminId: user.id,
    })

    // ========================================================================
    // Set status to 'sending'
    // ========================================================================
    await serviceClient.rpc('admin_update_campaign_status', {
      p_campaign_id: campaign_id,
      p_status: 'sending',
      p_sent_count: 0,
    })

    // ========================================================================
    // Render template
    // ========================================================================
    const isOutreach = campaign.audience_source === 'outreach'
    const rendered = await renderTemplate(serviceClient, campaign.template_key, {})
    if (!rendered) {
      await serviceClient.rpc('admin_update_campaign_status', {
        p_campaign_id: campaign_id,
        p_status: 'failed',
        p_sent_count: 0,
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to render template' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // For outreach campaigns, fetch the raw template for per-recipient personalization
    let outreachTemplate: any = null
    let outreachContactMap: Map<string, { contact_name: string; club_name: string; country: string }> | null = null

    if (isOutreach) {
      outreachTemplate = await getActiveTemplate(serviceClient, campaign.template_key)
    }

    // ========================================================================
    // Query recipients
    // ========================================================================
    const audienceFilter = campaign.audience_filter || {}
    const filterCountry = audienceFilter.country || null
    let recipients: Array<{ email: string; recipientId: string | null; recipientRole: string; recipientCountry: string | null }>

    if (isOutreach) {
      // Query outreach_contacts — exclude bounced/unsubscribed/signed_up
      let outreachQuery = serviceClient
        .from('outreach_contacts')
        .select('id, email, contact_name, club_name, country, status')
        .not('status', 'in', '("bounced","unsubscribed","signed_up")')

      // Filter by specific contact IDs if provided
      const contactIds = Array.isArray(audienceFilter.contact_ids) ? audienceFilter.contact_ids : null
      if (contactIds && contactIds.length > 0) {
        outreachQuery = outreachQuery.in('id', contactIds)
      }

      if (filterCountry) {
        outreachQuery = outreachQuery.ilike('country', `%${filterCountry}%`)
      }

      const filterClub = audienceFilter.club || null
      if (filterClub) {
        outreachQuery = outreachQuery.ilike('club_name', `%${filterClub}%`)
      }

      const filterStatus = audienceFilter.status || null
      if (filterStatus) {
        outreachQuery = outreachQuery.eq('status', filterStatus)
      }

      const { data: outreachData, error: outreachError } = await outreachQuery

      if (outreachError) {
        logger.error('Failed to query outreach contacts', { error: outreachError.message })
        await serviceClient.rpc('admin_update_campaign_status', {
          p_campaign_id: campaign_id,
          p_status: 'failed',
          p_sent_count: 0,
        })
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to query outreach contacts' }),
          { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }

      // Build lookup map for per-recipient personalization
      outreachContactMap = new Map()
      recipients = (outreachData || []).map((c: any) => {
        outreachContactMap!.set(c.email, {
          contact_name: c.contact_name || '',
          club_name: c.club_name || '',
          country: c.country || '',
        })
        return {
          email: c.email as string,
          recipientId: null,
          recipientRole: 'outreach',
          recipientCountry: c.country || null,
        }
      })
    } else {
      // Original path: query profiles
      // Support both "roles" array and legacy "role" string
      const filterRoles: string[] = Array.isArray(audienceFilter.roles) && audienceFilter.roles.length > 0
        ? audienceFilter.roles
        : audienceFilter.role ? [audienceFilter.role] : []

      let recipientQuery = serviceClient
        .from('profiles')
        .select('id, email, full_name, role, nationality_country_id, countries!profiles_nationality_country_id_fkey(code, name)')
        .not('email', 'is', null)
        .neq('email', '')
        .eq('is_blocked', false)
        .eq('is_test_account', false)

      if (filterRoles.length === 1) {
        recipientQuery = recipientQuery.eq('role', filterRoles[0])
      } else if (filterRoles.length > 1) {
        recipientQuery = recipientQuery.in('role', filterRoles)
      }

      const { data: recipientData, error: recipientError } = await recipientQuery

      if (recipientError) {
        logger.error('Failed to query recipients', { error: recipientError.message })
        await serviceClient.rpc('admin_update_campaign_status', {
          p_campaign_id: campaign_id,
          p_status: 'failed',
          p_sent_count: 0,
        })
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to query recipients' }),
          { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }

      // Apply country filter client-side (join filtering)
      let profileRecipients = (recipientData || []).map((r: any) => ({
        email: r.email as string,
        recipientId: r.id as string,
        recipientRole: r.role as string,
        recipientCountry: r.countries?.code || null,
        countryCode: r.countries?.code || null,
      }))

      if (filterCountry) {
        profileRecipients = profileRecipients.filter(r => r.countryCode === filterCountry)
      }

      recipients = profileRecipients
    }

    if (recipients.length === 0) {
      logger.warn('No recipients found for campaign', { campaignId: campaign_id })
      await serviceClient.rpc('admin_update_campaign_status', {
        p_campaign_id: campaign_id,
        p_status: 'sent',
        p_sent_count: 0,
      })
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No recipients matched the audience filter' }),
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Recipients found', { count: recipients.length, audienceSource: isOutreach ? 'outreach' : 'users' })

    // ========================================================================
    // Send via batch
    // ========================================================================
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      await serviceClient.rpc('admin_update_campaign_status', {
        p_campaign_id: campaign_id,
        p_status: 'failed',
        p_sent_count: 0,
      })
      return new Response(
        JSON.stringify({ success: false, error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Build per-recipient rendering function for outreach campaigns
    let renderForRecipient: ((recipient: RecipientInfo) => { html: string; text: string; subject: string }) | undefined

    if (isOutreach && outreachTemplate && outreachContactMap) {
      renderForRecipient = (recipient: RecipientInfo) => {
        const contact = outreachContactMap!.get(recipient.email)
        const contactName = contact?.contact_name || ''
        const vars: Record<string, string> = {
          contact_name: contactName,
          contact_name_greeting: contactName ? ` ${contactName}` : '',
          club_name: contact?.club_name || '',
          country: contact?.country || '',
          cta_url: 'https://oplayr.com/signup',
        }
        const subject = interpolateVariables(outreachTemplate.subject_template, vars)
        const { html } = renderContentBlocks(outreachTemplate.content_json, vars)
        const text = outreachTemplate.text_template
          ? interpolateVariables(outreachTemplate.text_template, vars)
          : subject
        return { html, text, subject }
      }
    }

    const batchResult = await sendTrackedBatch({
      supabase: serviceClient,
      resendApiKey,
      recipients: recipients.map(r => ({
        email: r.email,
        recipientId: r.recipientId || undefined,
        recipientRole: r.recipientRole,
        recipientCountry: r.recipientCountry || undefined,
      })),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      templateKey: campaign.template_key,
      campaignId: campaign_id,
      logger,
      renderForRecipient,
    })

    // ========================================================================
    // Update campaign status
    // ========================================================================
    const finalStatus = batchResult.stats.failed > 0 && batchResult.stats.sent === 0 ? 'failed' : 'sent'
    await serviceClient.rpc('admin_update_campaign_status', {
      p_campaign_id: campaign_id,
      p_status: finalStatus,
      p_sent_count: batchResult.stats.sent,
    })

    logger.info('Campaign send complete', {
      campaignId: campaign_id,
      status: finalStatus,
      sent: batchResult.stats.sent,
      failed: batchResult.stats.failed,
      durationMs: batchResult.stats.durationMs,
    })

    return new Response(
      JSON.stringify({
        success: true,
        sent: batchResult.stats.sent,
        failed: batchResult.stats.failed,
        duration_ms: batchResult.stats.durationMs,
      }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    logger.error('Campaign send handler error', {
      error: error instanceof Error ? error.message : 'Unknown',
    })
    captureException(error, { functionName: 'admin-send-campaign', correlationId })
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  }
})
