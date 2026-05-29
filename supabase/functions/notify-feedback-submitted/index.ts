// deno-lint-ignore-file no-explicit-any
// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * notify-feedback-submitted
 *
 * Called by useFeedback after a successful submit_user_feedback RPC.
 * Body: { feedback_id: string }
 *
 * Fetches the row + the submitter's profile, sends a plain-text
 * admin notification email via Resend. Fire-and-forget from the
 * client's perspective — failures here don't roll back the feedback
 * row (which is what we want; the row is the source of truth and is
 * already persisted by the time this runs).
 *
 * Auth: JWT verified (verify_jwt=true in config.toml). The function
 * only acts on a feedback row OWNED by the caller — defense against
 * a malicious user triggering notifications for someone else's
 * feedback.
 *
 * Env:
 *   RESEND_API_KEY            — required
 *   FEEDBACK_NOTIFY_EMAIL     — recipient address (defaults to
 *                                tianurien@gmail.com per memory)
 *   FEEDBACK_NOTIFY_FROM      — sender address (defaults to
 *                                "HOCKIA <feedback@inhockia.com>")
 *   FEEDBACK_NOTIFY_BASE_URL  — used to build the deep-link to
 *                                /admin/feedback in the email body
 */

const DEFAULT_RECIPIENT = 'tianurien@gmail.com'
// Must be a verified Resend sender — see the existing pattern in
// _shared/email-sender.ts and _shared/reference-request-email.ts.
// Using a non-verified subdomain would silently 401 at Resend.
const DEFAULT_FROM = 'HOCKIA Feedback <team@inhockia.com>'
const DEFAULT_BASE_URL = 'https://app.inhockia.com'

const CATEGORY_LABEL: Record<string, string> = {
  bug: '🐛 Bug',
  confusing: '🤔 Confusing',
  idea: '💡 Idea',
  praise: '💜 Praise',
  other: '📝 Other',
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Auth — JWT is already verified by Supabase before our handler
    // runs (verify_jwt=true). Pull the caller's id so we can check
    // ownership of the feedback row.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) {
      console.error('[notify-feedback] missing SUPABASE_URL or SUPABASE_ANON_KEY env')
      return new Response(JSON.stringify({ error: 'misconfigured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // Use a per-request anon client to resolve the caller from the JWT.
    const callerClient = await import('https://esm.sh/@supabase/supabase-js@2').then((m) =>
      m.createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      }),
    )
    const { data: userData } = await callerClient.auth.getUser()
    const callerId = userData?.user?.id
    if (!callerId) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Body
    let feedbackId: string
    try {
      const body = (await req.json()) as { feedback_id?: string }
      if (!body.feedback_id || typeof body.feedback_id !== 'string') throw new Error()
      feedbackId = body.feedback_id
    } catch {
      return new Response(JSON.stringify({ error: 'missing_feedback_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch the row via service role + ownership check
    const supabase = getServiceClient()
    const { data: row, error: rowError } = await supabase
      .from('user_feedback')
      .select(`
        id, user_id, user_role, category, body, is_urgent,
        route, route_raw, user_agent, viewport, environment, app_version,
        sentry_replay_url, created_at
      `)
      .eq('id', feedbackId)
      .maybeSingle()

    if (rowError || !row) {
      console.error('[notify-feedback] row not found', { feedbackId, rowError })
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if ((row as any).user_id !== callerId) {
      // A malicious caller is asking us to notify on someone else's
      // feedback. Refuse — don't leak that the row exists either.
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Submitter profile for the email body
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, username, email')
      .eq('id', (row as any).user_id)
      .maybeSingle()

    // Compose + send the email
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('[notify-feedback] RESEND_API_KEY not configured — skipping email send')
      // Return success anyway — the row is the source of truth.
      // Failing the client here would tell the user something went
      // wrong when actually their feedback is safely persisted.
      return new Response(JSON.stringify({ ok: true, email_sent: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const recipient = Deno.env.get('FEEDBACK_NOTIFY_EMAIL') ?? DEFAULT_RECIPIENT
    const fromAddress = Deno.env.get('FEEDBACK_NOTIFY_FROM') ?? DEFAULT_FROM
    const baseUrl = Deno.env.get('FEEDBACK_NOTIFY_BASE_URL') ?? DEFAULT_BASE_URL

    const r = row as any
    const p = (profile ?? {}) as any
    const urgentTag = r.is_urgent ? '⚠ URGENT ' : ''
    const categoryLabel = CATEGORY_LABEL[r.category as string] ?? r.category
    const subjectSnippet = (r.body as string).slice(0, 60).replace(/\s+/g, ' ')
    const subject = `[HOCKIA Feedback] ${urgentTag}${categoryLabel} (${r.user_role}): ${subjectSnippet}${
      (r.body as string).length > 60 ? '…' : ''
    }`

    const adminLink = `${baseUrl}/admin/feedback`
    const lines: string[] = [
      `New feedback from ${p.full_name ?? p.username ?? 'a HOCKIA user'} (${r.user_role}).`,
      '',
      `Category: ${categoryLabel}`,
      r.is_urgent ? 'Marked URGENT' : null,
      `Submitted: ${r.created_at}`,
      r.route ? `Route: ${r.route}` : null,
      r.viewport ? `Viewport: ${r.viewport}` : null,
      r.environment ? `Environment: ${r.environment}` : null,
      r.app_version ? `App version: ${(r.app_version as string).slice(0, 8)}` : null,
      '',
      '— Message —',
      r.body,
      '',
      '— Open in admin portal —',
      adminLink,
      '',
      '(Sign in as tianurien@gmail.com or tianurien@hotmail.com to triage.)',
    ]
    const textBody = lines.filter((l) => l !== null).join('\n')

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [recipient],
        subject,
        text: textBody,
      }),
    })

    if (!resendResponse.ok) {
      const errBody = await resendResponse.text()
      console.error('[notify-feedback] Resend API failed', {
        status: resendResponse.status,
        body: errBody.slice(0, 200),
      })
      // Still return 200 to the client — see comment above.
      return new Response(JSON.stringify({ ok: true, email_sent: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, email_sent: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[notify-feedback] uncaught', err)
    return new Response(
      JSON.stringify({ error: 'internal', detail: String(err instanceof Error ? err.message : err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
