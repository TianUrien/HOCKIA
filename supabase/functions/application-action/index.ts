// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { hashToken } from '../_shared/action-tokens.ts'

/**
 * ============================================================================
 * application-action — one-click triage links from the weekly digest email
 * ============================================================================
 *
 * Public endpoint (verify_jwt=false — recipients click from their inbox,
 * logged out). Security model:
 *   - capability URL: unguessable 32-byte token, stored hashed, single-use,
 *     expiring; all state transitions preconditioned on status='pending'
 *     inside the atomic apply_email_action() RPC (a stale link can never
 *     overwrite in-app triage or the expiry sweep).
 *   - GET NEVER MUTATES. Mail scanners (SafeLinks etc.) prefetch GET links;
 *     executing on GET would let a scanner triage applications. GET renders:
 *       shortlisted/maybe → an auto-submitting POST form (instant for humans,
 *                           inert for non-JS scanners; <noscript> button)
 *       rejected          → an explicit confirmation page (spec: one-tap
 *                           confirm before a rejection)
 *   - POST executes and renders the outcome page.
 *   - IP rate-limited via check_rate_limit (fail-closed).
 * ============================================================================
 */

const BRAND = '#8026FA'
const RATE_LIMIT_PER_MIN = 60

type Action = 'shortlisted' | 'maybe' | 'rejected'

const ACTION_LABEL: Record<Action, string> = {
  shortlisted: '⭐ Good fit',
  maybe: '❓ Maybe',
  rejected: '✗ Not a fit',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function page(opts: {
  title: string
  emoji: string
  heading: string
  body: string
  formHtml?: string
  ctaUrl?: string
  ctaLabel?: string
  autoSubmit?: boolean
}): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(opts.title)} · HOCKIA</title>
<style>
  body{margin:0;background:#f6f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;}
  .card{background:#fff;border-radius:16px;max-width:420px;width:100%;padding:32px 28px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08);}
  .emoji{font-size:40px;line-height:1;}
  h1{font-size:20px;margin:14px 0 8px;}
  p{font-size:14.5px;color:#4b5563;line-height:1.55;margin:0 0 6px;}
  .btn{display:inline-block;margin-top:18px;background:${BRAND};color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600;border:0;cursor:pointer;}
  .btn.secondary{background:#f3f4f6;color:#374151;}
  .brand{margin-top:22px;font-size:12px;color:#9ca3af;letter-spacing:.4px;}
</style>
</head>
<body>
  <div class="card">
    <div class="emoji">${opts.emoji}</div>
    <h1>${escapeHtml(opts.heading)}</h1>
    <p>${opts.body}</p>
    ${opts.formHtml ?? ''}
    ${opts.ctaUrl ? `<div><a class="btn${opts.formHtml ? ' secondary' : ''}" href="${opts.ctaUrl}">${escapeHtml(opts.ctaLabel ?? 'Open HOCKIA')}</a></div>` : ''}
    <div class="brand">HOCKIA</div>
  </div>
  ${opts.autoSubmit ? '<script>document.getElementById("action-form").submit()</script>' : ''}
</body>
</html>`
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}

function appUrl(opportunityId?: string | null): string {
  const base = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
  return opportunityId ? `${base}/dashboard/opportunities/${opportunityId}/applicants` : `${base}/dashboard`
}

function outcomePage(outcome: string, info: {
  action?: Action
  applicant_name?: string
  opportunity_id?: string
  opportunity_title?: string
}): Response {
  const name = info.applicant_name ? escapeHtml(info.applicant_name) : 'The applicant'
  const cta = appUrl(info.opportunity_id)
  switch (outcome) {
    case 'applied':
      switch (info.action) {
        case 'shortlisted':
          return page({
            title: 'Added to shortlist', emoji: '⭐', heading: `${name} added to your shortlist`,
            body: `They'll see they're on your shortlist for ${escapeHtml(info.opportunity_title ?? 'your opportunity')}.`,
            ctaUrl: cta, ctaLabel: 'Review applicants in HOCKIA',
          })
        case 'maybe':
          return page({
            title: 'Marked as Maybe', emoji: '🤔', heading: `${name} marked as Maybe`,
            body: 'You can revisit them anytime in your dashboard. They see their application as under review.',
            ctaUrl: cta, ctaLabel: 'Review applicants in HOCKIA',
          })
        default:
          return page({
            title: 'Marked as Not a fit', emoji: '✅', heading: `${name} marked as Not a fit`,
            body: 'They will be notified honestly — a clear answer beats silence.',
            ctaUrl: cta, ctaLabel: 'Review applicants in HOCKIA',
          })
      }
    case 'already_handled':
      return page({
        title: 'Already handled', emoji: '👍', heading: 'This application was already handled',
        body: `${name}'s application isn't pending anymore — it was already responded to (in the app, from an earlier email, or it closed automatically). Nothing was changed.`,
        ctaUrl: cta, ctaLabel: 'Open in HOCKIA',
      })
    case 'used':
      return page({
        title: 'Link already used', emoji: '✅', heading: 'This link was already used',
        body: 'Your response was recorded the first time — nothing was changed.',
        ctaUrl: cta, ctaLabel: 'Open in HOCKIA',
      })
    case 'expired':
      return page({
        title: 'Link expired', emoji: '⌛', heading: 'This link has expired',
        body: 'Action links work for 14 days. You can still respond from your dashboard.',
        ctaUrl: cta, ctaLabel: 'Open in HOCKIA',
      })
    default:
      return page({
        title: 'Invalid link', emoji: '🔗', heading: "This link isn't valid",
        body: 'It may have been truncated by your email client. You can respond from your dashboard instead.',
        ctaUrl: appUrl(), ctaLabel: 'Open HOCKIA',
      })
  }
}

async function rateLimited(supabase: any, req: Request): Promise<boolean> {
  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim())
    || req.headers.get('cf-connecting-ip')
    || 'unknown'
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_identifier: ip,
      p_action_type: 'email_action',
      p_max_requests: RATE_LIMIT_PER_MIN,
      p_window_seconds: 60,
    })
    if (error) return true // fail-closed: this endpoint mutates state
    return !(data as any)?.allowed
  } catch {
    return true
  }
}

function extractToken(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim()
  // 32 random bytes, base64url, unpadded → exactly 43 chars.
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)

  try {
    const url = new URL(req.url)
    const supabase = getServiceClient()

    if (req.method !== 'GET' && req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    if (await rateLimited(supabase, req)) {
      return page({
        title: 'Too many requests', emoji: '⏳', heading: 'Too many requests',
        body: 'Please wait a minute and try the link again.',
      })
    }

    // Token: POST body first (the executing form), query string otherwise.
    let rawToken: string | null = null
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') ?? ''
      if (contentType.includes('form')) {
        const form = await req.formData()
        rawToken = extractToken(form.get('t')?.toString() ?? null)
      }
      rawToken ??= extractToken(url.searchParams.get('t'))
    } else {
      rawToken = extractToken(url.searchParams.get('t'))
    }
    if (!rawToken) return outcomePage('invalid', {})

    const tokenHash = await hashToken(rawToken)

    if (req.method === 'POST') {
      // ── Execute (atomic: validate + status change + token burn in one RPC) ──
      const { data, error } = await supabase.rpc('apply_email_action', { p_token_hash: tokenHash })
      if (error) {
        captureException(error, { functionName: 'application-action', correlationId })
        return page({
          title: 'Something went wrong', emoji: '⚠️', heading: 'Something went wrong',
          body: 'Your response was not recorded. Please try again, or respond from your dashboard.',
          ctaUrl: appUrl(), ctaLabel: 'Open HOCKIA',
        })
      }
      const result = (data ?? {}) as any
      return outcomePage(result.outcome ?? 'invalid', result)
    }

    // ── GET: read-only peek, then render the appropriate (non-mutating) page ──
    const { data: token, error: peekError } = await supabase
      .from('email_action_tokens')
      .select(`
        action, used_at, expires_at,
        application:opportunity_applications (
          id, status, opportunity_id,
          opportunity:opportunities (id, title),
          applicant:profiles (full_name)
        )
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (peekError) {
      captureException(peekError, { functionName: 'application-action', correlationId })
      return outcomePage('invalid', {})
    }
    if (!token || !(token as any).application) return outcomePage('invalid', {})

    const app = (token as any).application
    const info = {
      action: (token as any).action as Action,
      applicant_name: app.applicant?.full_name ?? undefined,
      opportunity_id: app.opportunity_id,
      opportunity_title: app.opportunity?.title ?? undefined,
    }

    if ((token as any).used_at) return outcomePage('used', info)
    if (new Date((token as any).expires_at).getTime() < Date.now()) return outcomePage('expired', info)
    if (app.status !== 'pending') return outcomePage('already_handled', info)

    const postUrl = `${url.origin}${url.pathname}`
    const formHtml = `
      <form id="action-form" method="POST" action="${postUrl}">
        <input type="hidden" name="t" value="${rawToken}">
        <button class="btn" type="submit">${
          info.action === 'rejected'
            ? `Yes, mark ${escapeHtml(info.applicant_name ?? 'this applicant')} as Not a fit`
            : 'Confirm'
        }</button>
      </form>`

    if (info.action === 'rejected') {
      // Explicit human confirmation before a rejection (spec) — no auto-submit.
      return page({
        title: 'Confirm: Not a fit', emoji: '✋', heading: `Mark ${escapeHtml(info.applicant_name ?? 'this applicant')} as Not a fit?`,
        body: `For ${escapeHtml(info.opportunity_title ?? 'your opportunity')}. They'll be notified honestly — a clear answer beats silence.`,
        formHtml,
        ctaUrl: appUrl(info.opportunity_id), ctaLabel: 'Review in HOCKIA instead',
      })
    }

    // shortlisted / maybe: auto-submit for humans; inert for non-JS scanners.
    return page({
      title: 'Confirming…', emoji: info.action === 'shortlisted' ? '⭐' : '🤔',
      heading: `Recording: ${ACTION_LABEL[info.action]}`,
      body: `${escapeHtml(info.applicant_name ?? 'Applicant')} · ${escapeHtml(info.opportunity_title ?? '')}<br><noscript>JavaScript is off — tap Confirm below.</noscript>`,
      formHtml,
      autoSubmit: true,
    })
  } catch (error) {
    captureException(error, { functionName: 'application-action', correlationId })
    return page({
      title: 'Something went wrong', emoji: '⚠️', heading: 'Something went wrong',
      body: 'Please try again, or respond from your dashboard.',
      ctaUrl: appUrl(), ctaLabel: 'Open HOCKIA',
    })
  }
})
