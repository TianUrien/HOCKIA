// The campaign-draft request, with everything it touches passed in, so the
// deno suite runs the whole path (who may call, the limit, the model reply,
// what is logged) with the model call replaced. The edge function
// (campaign-draft/index.ts) only wires the real client, key and fetch.

import type { RateLimitResult } from './rate-limit.ts'
import type { AiUsageInput } from './aiUsage.ts'
import { SHORT_ANSWER_MAX_TOKENS, SHORT_ANSWER_OUTPUT } from './role-ask.ts'
import { CAMPAIGN_DRAFT_SYSTEM, CAMPAIGN_DRAFT_TOOL, cleanCampaignText, validateCampaignDraft } from './campaign-draft-from-text.ts'

export const CAMPAIGN_DRAFT_LIMIT_PER_DAY = 15
export const CAMPAIGN_DRAFT_TIMEOUT_MS = 20_000

export interface CampaignDraftDeps {
  /** The user the bearer token belongs to, or null. */
  userIdFromToken: (jwt: string) => Promise<string | null>
  /** The caller's own profile, read by the id in the token. */
  profile: (userId: string) => Promise<{ role?: string | null; is_blocked?: boolean | null } | null>
  /** One slot of the day's allowance. Called right before the model. */
  takeSlot: (userId: string) => Promise<RateLimitResult>
  recordUsage: (row: AiUsageInput) => Promise<unknown>
  apiKey: string | undefined
  model: string
  fetch: typeof fetch
  cors: Record<string, string>
  log?: (message: string) => void
}

interface ModelReply {
  stop_reason?: string | null
  content?: Array<{ type: string; name?: string; input?: unknown }>
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
}

/** The request sent to the model: the sentence between markers it cannot close, never as instructions. */
export function campaignDraftRequest(model: string, text: string) {
  return {
    model,
    // Newer models reason before they answer and that reasoning counts toward
    // max_tokens: a cap sized for the tool call alone can be spent before the
    // call is written (role-ask.ts, found 2026-11-15). Same cap and effort.
    max_tokens: SHORT_ANSWER_MAX_TOKENS,
    output_config: SHORT_ANSWER_OUTPUT,
    system: [{ type: 'text', cache_control: { type: 'ephemeral' }, text: CAMPAIGN_DRAFT_SYSTEM }],
    tools: [CAMPAIGN_DRAFT_TOOL],
    // "auto", not a forced tool: a reply with no tool call is treated as unavailable.
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `<brand_sentence>\n${text}\n</brand_sentence>` }],
  }
}

export async function handleCampaignDraft(req: Request, deps: CampaignDraftDeps): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...deps.cors, 'Content-Type': 'application/json' } })
  const log = deps.log ?? ((m: string) => console.error(m))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: deps.cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const userId = jwt ? await deps.userIdFromToken(jwt) : null
  if (!userId) return json({ error: 'auth_required' }, 401)
  // Brands only, and the brand is whoever holds the token: the body names nobody.
  const p = await deps.profile(userId)
  if (!p || p.role !== 'brand' || p.is_blocked) return json({ error: 'forbidden' }, 403)

  let body: { text?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const text = cleanCampaignText(body?.text)
  if (text.length < 3) return json({ error: 'text_required' }, 400)

  if (!deps.apiKey) return json({ draft: null, reason: 'unavailable' })
  // Fail closed: this call spends money, so a limiter that cannot answer refuses it.
  const slot = await deps.takeSlot(userId)
  if (slot.error) {
    log(`[campaign-draft] rate limit check failed: ${slot.error}`)
    return json({ draft: null, reason: 'unavailable' })
  }
  if (!slot.allowed) return json({ draft: null, reason: 'limit' })

  let usage: ModelReply['usage'] | null = null
  try {
    const res = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': deps.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(campaignDraftRequest(deps.model, text)),
      signal: AbortSignal.timeout(CAMPAIGN_DRAFT_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}`)
    const data = (await res.json()) as ModelReply
    usage = data.usage ?? null
    const call = (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === CAMPAIGN_DRAFT_TOOL.name)
    // A refusal is never a draft, and a reply cut at max_tokens can carry a
    // tool call that is only half written.
    if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') throw new Error(`stopped: ${data.stop_reason}`)
    if (!call) throw new Error(`no tool call (stop_reason ${data.stop_reason ?? 'none'}, blocks ${(data.content ?? []).map((c) => c.type).join('+') || 'none'})`)
    // Which field was left out and which check did it: names only, so a
    // refused sentence can be explained without logging what anyone wrote.
    const dropped: string[] = []
    const draft = validateCampaignDraft(call.input, text, dropped)
    if (!draft) log(`[campaign-draft] no draft: ${dropped.join(', ') || 'nothing usable'}`)
    else if (dropped.length) log(`[campaign-draft] dropped: ${dropped.join(', ')}`)
    return draft ? json({ draft, source: 'ai' }) : json({ draft: null, reason: 'unavailable' })
  } catch (err) {
    // The error only: never the sentence, never the model's text.
    log(`[campaign-draft] ${err instanceof Error ? err.message : String(err)}`)
    return json({ draft: null, reason: 'unavailable' })
  } finally {
    if (usage) {
      await deps.recordUsage({
        user_id: userId,
        function: 'campaign-draft',
        provider: 'claude',
        model: deps.model,
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
        cached_tokens: usage.cache_read_input_tokens ?? null,
      })
    }
  }
}
