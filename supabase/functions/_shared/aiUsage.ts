/**
 * AI cost log + daily question cap (founder ruling 2026-10-03).
 *
 *   recordAiUsage   one ai_usage_log row per answered question, written with
 *                   the service-role client. Cost comes from aiPricing.ts.
 *                   Never throws: the log must not fail a response.
 *   aiQuestionCapReached   true when the member already asked AI_DAILY_QUESTION_CAP
 *                   questions since UTC midnight (ai_questions_today, service_role
 *                   only). Fails OPEN on an RPC error so a logging outage never
 *                   locks members out; the error is reported by the caller.
 *
 * Migration: supabase/migrations/20261003140000_ai_usage_log.sql
 */

import { estimateCostUsd, modelForProvider } from './aiPricing.ts'

/** Questions per member per UTC day (founder ruling 2026-10-03). */
export const AI_DAILY_QUESTION_CAP = 30

export interface AiUsageInput {
  user_id: string
  /** Edge function name, e.g. 'nl-search'. */
  function: string
  provider: string
  /** Resolved model id; derived from the provider when omitted. */
  model?: string | null
  input_tokens: number | null
  output_tokens: number | null
  cached_tokens?: number | null
}

export interface AiUsageRow {
  user_id: string
  function: string
  provider: string
  model: string
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number
}

/** Minimal client surface (the typed service client and a test stub both fit). */
export interface AiUsageClient {
  // deno-lint-ignore no-explicit-any
  from: (table: any) => { insert: (row: any) => PromiseLike<{ error: any }> }
  // deno-lint-ignore no-explicit-any
  rpc: (fn: any, args?: any) => PromiseLike<{ data: any; error: any }>
}

/** Build the row that recordAiUsage inserts (pure; unit-tested). */
export function buildAiUsageRow(input: AiUsageInput, claudeModel?: string): AiUsageRow {
  const model = input.model || modelForProvider(input.provider, claudeModel)
  const { cost_usd } = estimateCostUsd(model, {
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
    cached_tokens: input.cached_tokens ?? null,
  })
  return {
    user_id: input.user_id,
    function: input.function,
    provider: input.provider,
    model,
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
    cost_usd,
  }
}

export async function recordAiUsage(client: AiUsageClient, input: AiUsageInput): Promise<boolean> {
  try {
    const claudeModel = typeof Deno !== 'undefined' ? Deno.env.get('CLAUDE_MODEL') : undefined
    const { error } = await client.from('ai_usage_log').insert({ ...buildAiUsageRow(input, claudeModel) })
    return !error
  } catch {
    return false
  }
}

export interface CapCheck {
  reached: boolean
  /** Questions asked today, or null when the RPC failed (fail-open). */
  count: number | null
  error: string | null
}

export async function aiQuestionCapReached(
  client: AiUsageClient,
  userId: string,
  cap: number = AI_DAILY_QUESTION_CAP,
): Promise<CapCheck> {
  try {
    const { data, error } = await client.rpc('ai_questions_today', { p_user: userId })
    if (error) return { reached: false, count: null, error: error.message ?? String(error) }
    const count = typeof data === 'number' ? data : Number(data ?? 0)
    if (!Number.isFinite(count)) return { reached: false, count: null, error: 'non-numeric count' }
    return { reached: count >= cap, count, error: null }
  } catch (err) {
    return { reached: false, count: null, error: err instanceof Error ? err.message : String(err) }
  }
}
