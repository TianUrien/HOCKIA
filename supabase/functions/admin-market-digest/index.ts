/**
 * admin-market-digest — sends the weekly Market Intelligence email to the
 * admin (Market Phase 3: the market reports to you).
 *
 * Trigger chain: pg_cron (Mon 09:00 UTC) → enqueue_admin_market_digest() →
 * INSERT into admin_digest_queue (payload = admin_market_intelligence
 * snapshot, computed at enqueue time) → dashboard database webhook → here.
 *
 * The email is: next-best-actions (same rules engine as the Market tab, via
 * _shared/market-rules.ts) + a health snapshot + the burned-player list +
 * top corridors. One recipient (app_settings.admin_digest_email), internal
 * tooling — HTML is built inline, delivery goes through sendTrackedEmail
 * (retries + email_sends recording).
 *
 * Idempotency: skips rows already stamped sent_at (webhook retries), and the
 * enqueue side has a 5-day cooldown, so a double-send needs two failures in
 * two different layers.
 */

import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { sendTrackedEmail, createLogger } from '../_shared/email-sender.ts'
import { evaluateMarketRules, type MarketRecommendation } from '../_shared/market-rules.ts'

interface QueueRow {
  id: string
  recipient: string
  // deno-lint-ignore no-explicit-any
  payload: any
  sent_at: string | null
}

const OWNER_COLOR: Record<MarketRecommendation['owner'], string> = {
  Acquisition: '#7c3aed',
  Ops: '#b45309',
  Product: '#1d4ed8',
  Growth: '#15803d',
}

// deno-lint-ignore no-explicit-any
function buildHtml(payload: any, recs: MarketRecommendation[]): string {
  const h = payload.health
  const responseRate = h.total_apps > 0 ? Math.round((h.responded_apps / h.total_apps) * 100) : null

  const recRows = recs.length === 0
    ? `<p style="color:#6b7280;font-size:14px;">No rules fired this week — the marketplace has no
       actionable alerts. (Silence means below-threshold, not missing data.)</p>`
    : recs.map((r, i) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top;width:24px;
                   font-weight:700;color:#111827;">${i + 1}</td>
        <td style="padding:10px 12px 10px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-weight:600;color:#111827;font-size:14px;">${r.title}
            <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;
                         font-size:11px;color:#ffffff;background:${OWNER_COLOR[r.owner]};">${r.owner}</span>
          </div>
          <div style="color:#4b5563;font-size:13px;margin-top:2px;">${r.detail}</div>
        </td>
      </tr>`).join('')

  // deno-lint-ignore no-explicit-any
  const burned = (payload.player_behavior?.burned?.players ?? []) as any[]
  const burnedBlock = burned.length === 0 ? '' : `
    <h3 style="font-size:14px;color:#111827;margin:24px 0 6px;">Players waiting on a first response</h3>
    <p style="font-size:12px;color:#6b7280;margin:0 0 8px;">Applied, never answered — personal outreach beats any campaign.</p>
    ${burned.map((p) => `<div style="font-size:13px;color:#374151;padding:2px 0;">
      ${p.name ?? '—'} · ${p.applications} app${p.applications === 1 ? '' : 's'} · last ${p.days_since_last_app}d ago
    </div>`).join('')}`

  // deno-lint-ignore no-explicit-any
  const flows = (payload.corridors?.flows ?? []).slice(0, 3) as any[]
  const corridorBlock = flows.length === 0 ? '' : `
    <h3 style="font-size:14px;color:#111827;margin:24px 0 6px;">Top corridors</h3>
    ${flows.map((f) => `<div style="font-size:13px;color:#374151;padding:2px 0;">
      ${f.from_country} → ${f.to_country} · ${f.applications} applications
    </div>`).join('')}`

  const stat = (label: string, value: string) => `
    <td style="padding:10px;background:#f9fafb;border-radius:8px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#111827;">${value}</div>
      <div style="font-size:11px;color:#6b7280;">${label}</div>
    </td>`

  return `
  <div style="max-width:600px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;">
    <h1 style="font-size:20px;color:#111827;margin:0 0 4px;">HOCKIA Market Digest</h1>
    <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">
      Weekly market intelligence · computed ${new Date(payload.meta.computed_at + 'Z').toUTCString()}
    </p>

    <h2 style="font-size:16px;color:#111827;margin:0 0 8px;">Next best actions</h2>
    <table style="width:100%;border-collapse:collapse;">${recRows}</table>

    <h3 style="font-size:14px;color:#111827;margin:24px 0 8px;">Marketplace health</h3>
    <table style="width:100%;border-spacing:6px;border-collapse:separate;">
      <tr>
        ${stat('Open vacancies', String(h.open_vacancies))}
        ${stat('Active supply', String(h.active_supply))}
        ${stat('Response rate', responseRate === null ? '—' : `${responseRate}%`)}
        ${stat('Cold vacancies', String(h.cold_vacancies))}
      </tr>
    </table>

    ${burnedBlock}
    ${corridorBlock}

    <p style="font-size:12px;color:#9ca3af;margin-top:28px;">
      Full detail: Admin → Opportunities → Market ·
      <a href="https://inhockia.com/admin/opportunities" style="color:#7c3aed;">open the dashboard</a><br/>
      Test accounts excluded · medians, not means.
    </p>
  </div>`
}

// deno-lint-ignore no-explicit-any
function buildText(payload: any, recs: MarketRecommendation[]): string {
  const h = payload.health
  const lines = [
    'HOCKIA Market Digest',
    '',
    'Next best actions:',
    ...(recs.length === 0
      ? ['  (no rules fired this week)']
      : recs.map((r, i) => `  ${i + 1}. [${r.owner}] ${r.title} — ${r.detail}`)),
    '',
    `Open vacancies: ${h.open_vacancies} · Active supply: ${h.active_supply} · ` +
    `Pending apps: ${h.pending_apps}/${h.total_apps} · Cold: ${h.cold_vacancies}`,
    '',
    'Full detail: https://inhockia.com/admin/opportunities',
  ]
  return lines.join('\n')
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('ADMIN_MARKET_DIGEST', correlationId)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      logger.error('RESEND_API_KEY not configured')
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const recordId = (body?.record?.id ?? null) as string | null
    if (!recordId) {
      logger.error('Malformed webhook payload (no record.id)')
      return new Response(JSON.stringify({ error: 'no record' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = getServiceClient()

    // The DB row is the source of truth (webhook bodies can be partial, and
    // retries re-deliver) — re-read it and skip if already sent.
    const { data: fresh } = await supabase
      .from('admin_digest_queue')
      .select('id, recipient, payload, sent_at')
      .eq('id', recordId)
      .maybeSingle()
    if (!fresh || fresh.sent_at) {
      logger.info(`Row ${recordId} already sent or gone — skipping`)
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const record = fresh as unknown as QueueRow

    const recs = evaluateMarketRules(record.payload)
    logger.info(`Evaluated rules: ${recs.length} recommendation(s)`)

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: record.recipient,
      subject: recs.length > 0
        ? `Market digest: ${recs[0].title}`
        : 'Market digest: no alerts this week',
      html: buildHtml(record.payload, recs),
      text: buildText(record.payload, recs),
      templateKey: 'admin_market_digest',
      logger,
      metadata: { digest: 'admin_market', queue_id: record.id },
    })

    await supabase
      .from('admin_digest_queue')
      .update(result.success
        ? { sent_at: new Date().toISOString() }
        : { error: result.error ?? 'send failed' })
      .eq('id', record.id)

    return new Response(JSON.stringify({ sent: result.success }), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    logger.error(`Unhandled: ${err instanceof Error ? err.message : String(err)}`)
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})