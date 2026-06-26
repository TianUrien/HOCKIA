/**
 * application-feedback — the kind, human explanation a PLAYER sees for their
 * application status (Phase 5 of application-clarity).
 *
 *   POST { application_id }   (Bearer: the player's session JWT)
 *   → 200 { message: string | null, status, cached }
 *
 * Flow:
 *   1. Auth — the requester must OWN the application.
 *   2. Read the current status + reason straight from opportunity_applications
 *      (status + metadata.status_reason). `pending` → no message (the UI shows a
 *      neutral "under review" line; no LLM call).
 *   3. Cache lives in its OWN column (ai_feedback) = { message, status, reason,
 *      source }, NOT in metadata — so the club's metadata.status_reason writes can
 *      never collide with it. A hit requires source==='ai' AND same status AND
 *      reason; a status/reason change naturally invalidates it, and a cached
 *      fallback (source!=='ai') is re-attempted rather than served forever.
 *   4. Miss → Claude Sonnet writes a 1–2 sentence message, guard-railed for tone
 *      + length. ANY failure (no key, API error, banned vocabulary, bad shape)
 *      falls back to deterministic copy (tagged source:'fallback').
 *
 * Tone contract (system prompt AND fallback): never blame the player, never imply
 * they aren't good enough, stay honest (no false hope), and offer ONE constructive
 * next step where one genuinely exists. The deterministic copy below mirrors
 * client/src/lib/applicationStatus.ts (applicationReasonPlayerCopy) — keep in sync.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import type { Json } from '../_shared/database.types.ts'

const MODEL = 'claude-sonnet-4-6'
const MESSAGE_MAX_CHARS = 320
// Clearly-harsh terms. If any slips into the LLM output we drop it and fall back
// to the deterministic copy — kept narrow to avoid false positives on kind prose.
const BANNED = [
  'not good enough', 'failure', 'unqualified', 'incompetent',
  'loser', 'worthless', 'mediocre', 'pathetic',
]
const RESPONDED = ['shortlisted', 'maybe', 'rejected']

interface StatusContext {
  status: string
  reason: string | null
  position: string
  clubName: string
  opportunityTitle: string
}

// Deterministic, kind fallback for a reason code. Mirrors the client copy.
function reasonCopy(reason: string | null): string | null {
  switch (reason) {
    case 'position_filled':
      return 'The position looks to be covered already — this is about timing, not your level. Openings still looking for your position may be a better fit.'
    case 'different_position':
      return "They're prioritising a different position for this opening. Opportunities matching your position are likely a stronger fit."
    case 'different_level':
      return "They're looking for a different level for this particular opening. Keep building your profile and proven experience."
    case 'timing':
      return "The timing or availability didn't line up for this one — worth keeping them on your radar for the future."
    case 'location':
      return "The location or relocation didn't work out for this opening."
    case 'eligibility':
      return 'There was a passport or eligibility consideration specific to this opening.'
    case 'profile_incomplete':
      return 'Adding more detail to your profile could help clubs picture you faster next time.'
    case 'video_missing':
      return 'Clubs often want footage before moving forward — a highlight reel or full-match video could strengthen future applications.'
    default:
      return null
  }
}

function fallbackMessage(ctx: StatusContext): string {
  const reason = reasonCopy(ctx.reason)
  switch (ctx.status) {
    case 'shortlisted':
      return `Good news — ${ctx.clubName} shortlisted you for ${ctx.position}. They're interested; keep your profile sharp while they review.`
    case 'maybe':
      return reason
        ? `${ctx.clubName} is still considering you for ${ctx.position}. ${reason}`
        : `${ctx.clubName} is still considering your application for ${ctx.position}. No decision yet — hang tight.`
    case 'rejected':
      return reason
        ? `You weren't selected for ${ctx.position} this time. ${reason} Keep going — the right fit is out there.`
        : `You weren't selected for ${ctx.position} this time. It usually comes down to fit, not ability — keep applying.`
    default:
      return `Your application for ${ctx.position} is in and awaiting review.`
  }
}

function systemPrompt(): string {
  return `You write a SHORT message (1-2 sentences, max ${MESSAGE_MAX_CHARS} characters) shown to a field-hockey player about the status of a job application on a recruitment platform.

RULES (strict):
- Be warm, honest and respectful. Address the player directly as "you".
- NEVER blame the player or imply they aren't good enough. A "not selected" outcome is about fit and timing, not their worth.
- Do not invent facts. Use ONLY the status, the club's stated reason, the position and the club name provided.
- No false hope and no filler. If they weren't selected, say so kindly and, where a reason is given, reflect it and offer ONE constructive next step.
- Output JSON exactly: {"message": "..."} and nothing else.`
}

function userPrompt(ctx: StatusContext): string {
  return JSON.stringify({
    status: ctx.status,
    club_name: ctx.clubName,
    position: ctx.position,
    opportunity_title: ctx.opportunityTitle,
    club_reason_code: ctx.reason,
    club_reason_plain: reasonCopy(ctx.reason),
  })
}

async function callClaude(ctx: StatusContext): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      // Cache the identical system prompt across calls (5-min window).
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt(ctx) }],
    }),
  })
  if (!response.ok) {
    throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`)
  }
  const data = await response.json() as { content: Array<{ type: string; text?: string }> }
  const text = data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim()
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(stripped) as { message?: unknown }
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
  if (!message || message.length > MESSAGE_MAX_CHARS) {
    throw new Error('invalid message: empty or too long')
  }
  const lower = message.toLowerCase()
  for (const banned of BANNED) {
    if (lower.includes(banned)) throw new Error(`banned vocabulary: ${banned}`)
  }
  return message
}

// The structured opportunities.position enum is the source of truth ('goalkeeper'
// -> 'Goalkeeper', 'head_coach' -> 'Head Coach').
function humanizePosition(pos: string | null | undefined): string | null {
  if (!pos) return null
  return pos.split('_').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
}

// Last-resort only: SOME titles look like "Arquera — CASI" (Position — Club). Only
// trust the head when a real separator is present — most titles are free text
// ("Senior Women's First XI Opportunity") where the whole string is NOT a position.
function derivePosition(title: string): string | null {
  const parts = title.split(/\s+[—–-]\s+/)
  if (parts.length < 2) return null
  return parts[0]?.trim() || null
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, corsHeaders)
  }

  try {
    const supabase = getServiceClient()

    // 1) Auth — must be the application's owner.
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (!jwt) return jsonResponse({ error: 'unauthenticated' }, 401, corsHeaders)
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
    if (userError || !userData.user) return jsonResponse({ error: 'unauthenticated' }, 401, corsHeaders)
    const userId = userData.user.id

    // 2) Body.
    let applicationId: string
    try {
      const body = await req.json() as { application_id?: string }
      if (!body.application_id || typeof body.application_id !== 'string') throw new Error()
      applicationId = body.application_id
    } catch {
      return jsonResponse({ error: 'missing_application_id' }, 400, corsHeaders)
    }

    // 3) Fetch application + verify ownership.
    const { data: app } = await supabase
      .from('opportunity_applications')
      .select('id, opportunity_id, applicant_id, status, metadata, ai_feedback')
      .eq('id', applicationId)
      .maybeSingle()
    if (!app) return jsonResponse({ error: 'not_found' }, 404, corsHeaders)
    if (app.applicant_id !== userId) return jsonResponse({ error: 'forbidden' }, 403, corsHeaders)

    const status = String(app.status)
    const metadata: Record<string, unknown> =
      app.metadata && typeof app.metadata === 'object' && !Array.isArray(app.metadata)
        ? (app.metadata as Record<string, unknown>)
        : {}
    const reason = typeof metadata.status_reason === 'string' ? metadata.status_reason : null

    // No club response yet → neutral, no LLM.
    if (!RESPONDED.includes(status)) {
      return jsonResponse({ message: null, status, cached: false }, 200, corsHeaders)
    }

    // 3a) Cache hit? Lives in its OWN column (ai_feedback), never in metadata, so
    //     the club's metadata.status_reason writes can't collide with it. Only a
    //     genuine AI message counts as a hit — a cached fallback (source!=='ai')
    //     is re-attempted so a transient Claude outage doesn't poison the cache.
    const cache =
      app.ai_feedback && typeof app.ai_feedback === 'object' && !Array.isArray(app.ai_feedback)
        ? (app.ai_feedback as Record<string, unknown>)
        : null
    if (
      cache && cache.source === 'ai' &&
      cache.status === status && (cache.reason ?? null) === reason &&
      typeof cache.message === 'string'
    ) {
      return jsonResponse({ message: cache.message, status, cached: true }, 200, corsHeaders)
    }

    // 4) Context: opportunity title + club name.
    const { data: opp } = await supabase
      .from('opportunities')
      .select('id, title, club_id, position')
      .eq('id', app.opportunity_id)
      .maybeSingle()
    const title = opp?.title ?? 'this role'
    let clubName = 'The club'
    if (opp?.club_id) {
      const { data: club } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', opp.club_id)
        .maybeSingle()
      if (club?.full_name) clubName = club.full_name
    }
    const ctx: StatusContext = {
      status,
      reason,
      // Structured enum first; only fall back to a title-derived position when the
      // title actually has a "Position — Club" separator; else a neutral phrase.
      position: humanizePosition(opp?.position) ?? derivePosition(title) ?? 'this role',
      clubName,
      opportunityTitle: title,
    }

    // 5) Generate (AI first, deterministic fallback on any failure). Tag the
    //    source so a fallback is never served as a permanent cache hit.
    let message: string
    let source: 'ai' | 'fallback'
    try {
      message = await callClaude(ctx)
      source = 'ai'
    } catch (err) {
      console.warn('application-feedback: AI fallback —', String(err))
      message = fallbackMessage(ctx)
      source = 'fallback'
    }

    // 6) Cache into the dedicated ai_feedback column (not metadata, not status), so
    //    nothing else's writes collide and no trigger fires.
    const feedback = { message, status, reason, source } as unknown as Json
    await supabase.from('opportunity_applications').update({ ai_feedback: feedback }).eq('id', applicationId)

    return jsonResponse({ message, status, cached: false }, 200, corsHeaders)
  } catch (err) {
    console.error('application-feedback error', err)
    return jsonResponse({ error: 'internal_error' }, 500, corsHeaders)
  }
})
