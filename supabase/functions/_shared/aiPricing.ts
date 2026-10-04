/**
 * Per-model LLM prices for the AI cost log (ai_usage_log.cost_usd).
 *
 * Prices are USD per 1M tokens, taken from the providers' public price lists
 * on 2026-10-03. They are a bookkeeping estimate for the monthly USD alert,
 * not an invoice: update this table when a provider changes its list price
 * and note the date. An unknown model is logged with cost 0 and
 * `priced: false` so the row still counts towards the daily question cap
 * and shows up as unpriced in the log.
 *
 *   gemini-2.5-flash   Google AI Studio paid tier, text (2026-10-03)
 *   claude-sonnet-4-6  Anthropic API list price; cache read = 10% of input (2026-10-03)
 *   gpt-4o-mini        OpenAI API list price (2026-10-03)
 */

export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  input: number
  /** USD per 1M output (completion) tokens. */
  output: number
  /** USD per 1M cached input tokens (billed instead of `input` for those tokens). */
  cachedInput: number
}

export const MODEL_PRICES_USD_PER_1M: Record<string, ModelPrice> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50, cachedInput: 0.075 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cachedInput: 0.30 },
  'claude-sonnet-5': { input: 2.00, output: 10.00, cachedInput: 0.20 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cachedInput: 0.075 },
}

/** Model id each LLM_PROVIDER value resolves to (mirrors _shared/llm-client.ts). */
export function modelForProvider(provider: string, claudeModel?: string): string {
  switch (provider) {
    case 'claude': return claudeModel || 'claude-sonnet-4-6'
    case 'openai': return 'gpt-4o-mini'
    case 'gemini':
    default: return 'gemini-2.5-flash'
  }
}

export interface UsageTokens {
  input_tokens: number | null
  output_tokens: number | null
  /** Subset of input_tokens served from the provider's prompt cache. */
  cached_tokens?: number | null
}

export interface CostEstimate {
  cost_usd: number
  priced: boolean
}

/**
 * Cost of one call in USD, rounded to 6 decimals (the column is numeric(10,6)).
 * Cached tokens are a subset of the input tokens: they are billed at the cache
 * rate and removed from the input count, never double counted.
 */
export function estimateCostUsd(model: string, usage: UsageTokens): CostEstimate {
  const price = MODEL_PRICES_USD_PER_1M[model]
  if (!price) return { cost_usd: 0, priced: false }
  const input = Math.max(0, usage.input_tokens ?? 0)
  const output = Math.max(0, usage.output_tokens ?? 0)
  const cached = Math.min(input, Math.max(0, usage.cached_tokens ?? 0))
  const raw =
    ((input - cached) * price.input + cached * price.cachedInput + output * price.output) / 1_000_000
  return { cost_usd: Math.round(raw * 1_000_000) / 1_000_000, priced: true }
}
