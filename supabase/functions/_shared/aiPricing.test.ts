import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MODEL_PRICES_USD_PER_1M, estimateCostUsd, modelForProvider } from './aiPricing.ts'

Deno.test('estimateCostUsd: input + output at the model list price', () => {
  const { cost_usd, priced } = estimateCostUsd('gemini-2.5-flash', { input_tokens: 1_000_000, output_tokens: 1_000_000 })
  assertEquals(priced, true)
  assertEquals(cost_usd, 0.30 + 2.50)
})

Deno.test('estimateCostUsd: cached tokens are billed at the cache rate, not twice', () => {
  const { cost_usd } = estimateCostUsd('claude-sonnet-4-6', {
    input_tokens: 1_000_000, output_tokens: 0, cached_tokens: 1_000_000,
  })
  assertEquals(cost_usd, 0.30)
  // Cached tokens can never exceed the input count.
  const capped = estimateCostUsd('claude-sonnet-4-6', { input_tokens: 10, output_tokens: 0, cached_tokens: 1_000_000 })
  assertEquals(capped.cost_usd, 0.000003)
})

Deno.test('estimateCostUsd: null tokens and unknown models cost 0', () => {
  assertEquals(estimateCostUsd('gpt-4o-mini', { input_tokens: null, output_tokens: null }).cost_usd, 0)
  const unknown = estimateCostUsd('some-future-model', { input_tokens: 500, output_tokens: 500 })
  assertEquals(unknown, { cost_usd: 0, priced: false })
})

Deno.test('estimateCostUsd: rounds to the 6 decimals of numeric(10,6)', () => {
  const { cost_usd } = estimateCostUsd('gpt-4o-mini', { input_tokens: 1234, output_tokens: 567 })
  assertEquals(cost_usd, Math.round((1234 * 0.15 + 567 * 0.60) / 1_000_000 * 1e6) / 1e6)
  assertEquals((String(cost_usd).split('.')[1]?.length ?? 0) <= 6, true)
})

Deno.test('modelForProvider mirrors llm-client and every result is priced', () => {
  assertEquals(modelForProvider('gemini'), 'gemini-2.5-flash')
  assertEquals(modelForProvider('anything-else'), 'gemini-2.5-flash')
  assertEquals(modelForProvider('claude'), 'claude-sonnet-4-6')
  assertEquals(modelForProvider('claude', 'claude-sonnet-5'), 'claude-sonnet-5')
  assertEquals(modelForProvider('openai'), 'gpt-4o-mini')
  for (const p of ['gemini', 'claude', 'openai']) {
    assertEquals(modelForProvider(p) in MODEL_PRICES_USD_PER_1M, true, `${p} has a price`)
  }
})
