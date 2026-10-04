import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  AI_DAILY_QUESTION_CAP,
  aiQuestionCapReached,
  buildAiUsageRow,
  recordAiUsage,
  type AiUsageClient,
} from './aiUsage.ts'

function stubClient(opts: {
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }
  insert?: (row: Record<string, unknown>) => { error: unknown }
}) {
  const inserted: { table: string; row: Record<string, unknown> }[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
  const client: AiUsageClient = {
    from: (table) => ({
      insert: (row) => {
        inserted.push({ table, row })
        return Promise.resolve(opts.insert ? opts.insert(row) : { error: null })
      },
    }),
    rpc: (fn, args) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: 0, error: null })
    },
  }
  return { client, inserted, rpcCalls }
}

Deno.test('buildAiUsageRow derives the model from the provider and prices the call', () => {
  const row = buildAiUsageRow({
    user_id: 'u1', function: 'nl-search', provider: 'gemini',
    input_tokens: 2_000_000, output_tokens: 1_000_000, cached_tokens: null,
  })
  assertEquals(row.model, 'gemini-2.5-flash')
  assertEquals(row.cost_usd, 0.60 + 2.50)
  assertEquals(row.user_id, 'u1')
  assertEquals(row.function, 'nl-search')
})

Deno.test('recordAiUsage inserts one ai_usage_log row through the given client', async () => {
  const { client, inserted } = stubClient({})
  const ok = await recordAiUsage(client, {
    user_id: 'u1', function: 'nl-search', provider: 'openai', input_tokens: 100, output_tokens: 50,
  })
  assertEquals(ok, true)
  assertEquals(inserted.length, 1)
  assertEquals(inserted[0].table, 'ai_usage_log')
  assertEquals(inserted[0].row.model, 'gpt-4o-mini')
  assertEquals(inserted[0].row.input_tokens, 100)
  assertEquals(inserted[0].row.output_tokens, 50)
})

Deno.test('recordAiUsage never throws on an insert error', async () => {
  const { client } = stubClient({ insert: () => ({ error: { message: 'boom' } }) })
  const ok = await recordAiUsage(client, {
    user_id: 'u1', function: 'nl-search', provider: 'gemini', input_tokens: 1, output_tokens: 1,
  })
  assertEquals(ok, false)
})

Deno.test('aiQuestionCapReached: under the cap passes, at the cap blocks', async () => {
  const under = stubClient({ rpc: () => ({ data: AI_DAILY_QUESTION_CAP - 1, error: null }) })
  const a = await aiQuestionCapReached(under.client, 'u1')
  assertEquals(a, { reached: false, count: 29, error: null })
  assertEquals(under.rpcCalls[0], { fn: 'ai_questions_today', args: { p_user: 'u1' } })

  const at = stubClient({ rpc: () => ({ data: AI_DAILY_QUESTION_CAP, error: null }) })
  const b = await aiQuestionCapReached(at.client, 'u1')
  assertEquals(b.reached, true)
  assertEquals(b.count, 30)

  const custom = stubClient({ rpc: () => ({ data: 3, error: null }) })
  assertEquals((await aiQuestionCapReached(custom.client, 'u1', 3)).reached, true)
})

Deno.test('aiQuestionCapReached fails open on an RPC error or a non-numeric result', async () => {
  const failing = stubClient({ rpc: () => ({ data: null, error: { message: 'permission denied' } }) })
  const a = await aiQuestionCapReached(failing.client, 'u1')
  assertEquals(a.reached, false)
  assertEquals(a.error, 'permission denied')

  const weird = stubClient({ rpc: () => ({ data: 'many', error: null }) })
  const b = await aiQuestionCapReached(weird.client, 'u1')
  assertEquals(b.reached, false)
  assertEquals(b.count, null)
})
