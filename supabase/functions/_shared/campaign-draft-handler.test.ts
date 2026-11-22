import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { CAMPAIGN_DRAFT_LIMIT_PER_DAY, campaignDraftRequest, handleCampaignDraft, type CampaignDraftDeps } from './campaign-draft-handler.ts'
import { SHORT_ANSWER_MAX_TOKENS } from './role-ask.ts'

const SENTENCE = 'I want players to write to us with questions about choosing a stick'
const TOOL_INPUT = { objective: 'ask', title: 'Questions about choosing a stick?', body: 'Write to us about sizes and materials.', need: 'gear', roles: ['player'], place: null, perk: null }
const reply = (over: Record<string, unknown> = {}) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', name: 'fill_campaign', input: TOOL_INPUT }],
  usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 700 },
  ...over,
})

/** A world where a brand calls and the model answers with a usable tool call; each test changes one thing. */
function world(over: Partial<CampaignDraftDeps> & { answer?: () => Response | Promise<Response> } = {}) {
  const seen = { calls: [] as string[], modelBodies: [] as Record<string, unknown>[], usage: [] as Record<string, unknown>[], logs: [] as string[] }
  const { answer, ...rest } = over
  const deps: CampaignDraftDeps = {
    cors: {},
    apiKey: 'test-key',
    model: 'test-model',
    userIdFromToken: (jwt) => { seen.calls.push('token'); return Promise.resolve(jwt === 'good' ? 'brand-user' : null) },
    profile: () => { seen.calls.push('profile'); return Promise.resolve({ role: 'brand', is_blocked: false }) },
    takeSlot: () => { seen.calls.push('limit'); return Promise.resolve({ allowed: true, retryAfter: null, error: null }) },
    recordUsage: (row) => { seen.usage.push(row as unknown as Record<string, unknown>); return Promise.resolve(true) },
    fetch: ((_url: string, init: RequestInit) => {
      seen.calls.push('model')
      seen.modelBodies.push(JSON.parse(String(init.body)))
      return Promise.resolve(answer ? answer() : Response.json(reply()))
    }) as unknown as typeof fetch,
    log: (m) => { seen.logs.push(m) },
    ...rest,
  }
  const call = (body: unknown = { text: SENTENCE }, token: string | null = 'good', method = 'POST') =>
    handleCampaignDraft(new Request('https://x.test/campaign-draft', {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }), deps)
  return { seen, call }
}

Deno.test('no token or an unknown token: 401, and nothing else happens', async () => {
  for (const token of [null, 'bad']) {
    const w = world()
    const res = await w.call(undefined, token)
    assertEquals(res.status, 401)
    assertEquals(w.seen.calls.filter((c) => c !== 'token'), [])
  }
})

Deno.test('a member who is not a brand, a blocked brand, or no profile: 403 before the limit and the model', async () => {
  for (const profile of [{ role: 'player', is_blocked: false }, { role: 'club', is_blocked: false }, { role: 'brand', is_blocked: true }, null]) {
    const w = world({ profile: () => Promise.resolve(profile) })
    const res = await w.call()
    assertEquals(res.status, 403)
    assertEquals(w.seen.calls, ['token'])
    assertEquals(w.seen.usage, [])
  }
})

Deno.test('the brand is the holder of the token: a body that names someone else changes nothing', async () => {
  const asked: string[] = []
  const w = world({ profile: (id) => { asked.push(id); return Promise.resolve({ role: 'brand' }) }, takeSlot: (id) => { asked.push(id); return Promise.resolve({ allowed: true, retryAfter: null, error: null }) } })
  await w.call({ text: SENTENCE, user_id: 'someone-else', brand_id: 'other-brand', profile_id: 'someone-else' })
  assertEquals(asked, ['brand-user', 'brand-user'])
  assertEquals(w.seen.usage[0].user_id, 'brand-user')
  assertEquals(JSON.stringify(w.seen.modelBodies[0]).includes('someone-else'), false)
})

Deno.test('a body that is not JSON or has no sentence: 400, and no slot is used', async () => {
  const bad = world()
  assertEquals((await bad.call('not json')).status, 400)
  const empty = world()
  assertEquals((await empty.call({ text: '  a ' })).status, 400)
  assertEquals([...bad.seen.calls, ...empty.seen.calls].includes('limit'), false)
})

Deno.test('the day\'s allowance is checked before the model: when it is used up, the model is never called', async () => {
  const w = world({ takeSlot: () => Promise.resolve({ allowed: false, retryAfter: 3600, error: null }) })
  const res = await w.call()
  assertEquals(await res.json(), { draft: null, reason: 'limit' })
  assertEquals(w.seen.calls.includes('model'), false)
  assertEquals(w.seen.usage, [])
  assertEquals(CAMPAIGN_DRAFT_LIMIT_PER_DAY, 15)
})

Deno.test('a limiter that cannot answer refuses the call (fail closed), as unavailable, not as a used-up day', async () => {
  const w = world({ takeSlot: () => Promise.resolve({ allowed: false, retryAfter: null, error: 'connection lost' }) })
  assertEquals(await (await w.call()).json(), { draft: null, reason: 'unavailable' })
  assertEquals(w.seen.calls.includes('model'), false)
})

Deno.test('no key configured: unavailable, without using a slot', async () => {
  const w = world({ apiKey: undefined })
  assertEquals(await (await w.call()).json(), { draft: null, reason: 'unavailable' })
  assertEquals(w.seen.calls.includes('limit'), false)
})

Deno.test('a usable reply becomes a validated draft, and the spend is logged without any text', async () => {
  const w = world()
  const res = await w.call()
  assertEquals(res.status, 200)
  const out = await res.json()
  assertEquals(out.draft.objective, 'ask')
  assertEquals(out.draft.title, 'Questions about choosing a stick?')
  assertEquals(w.seen.calls, ['token', 'profile', 'limit', 'model'])
  assertEquals(w.seen.usage, [{ user_id: 'brand-user', function: 'campaign-draft', provider: 'claude', model: 'test-model', input_tokens: 900, output_tokens: 120, cached_tokens: 700 }])
  assertEquals(w.seen.logs, [])
})

Deno.test('the request leaves room for reasoning, asks for low effort and never forces the tool', () => {
  const body = campaignDraftRequest('m', SENTENCE)
  assertEquals(body.max_tokens, SHORT_ANSWER_MAX_TOKENS)
  assertEquals(body.max_tokens >= 2000, true)
  assertEquals(body.output_config, { effort: 'low' })
  assertEquals(body.tool_choice, { type: 'auto' })
  assertEquals(body.messages[0].content, `<brand_sentence>\n${SENTENCE}\n</brand_sentence>`)
})

Deno.test('a refusal, a reply cut at max_tokens, no tool call, a model error and an unusable draft are all "unavailable"', async () => {
  const cases: Array<() => Response> = [
    () => Response.json(reply({ stop_reason: 'refusal', content: [] })),
    () => Response.json(reply({ stop_reason: 'max_tokens' })),
    () => Response.json(reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is a campaign.' }] })),
    () => new Response('overloaded', { status: 529 }),
    () => new Response('not json', { status: 200 }),
    () => Response.json(reply({ content: [{ type: 'tool_use', name: 'fill_campaign', input: { ...TOOL_INPUT, title: 'The #1 sticks', body: 'You will play better.' } }] })),
  ]
  for (const answer of cases) {
    const w = world({ answer })
    assertEquals(await (await w.call()).json(), { draft: null, reason: 'unavailable' })
  }
})

Deno.test('spend is logged whenever the reply could be read, even when no draft came of it; never the sentence', async () => {
  const cut = world({ answer: () => Response.json(reply({ stop_reason: 'max_tokens' })) })
  await cut.call()
  assertEquals(cut.seen.usage.length, 1)
  const failed = world({ answer: () => new Response('overloaded', { status: 529 }) })
  await failed.call()
  // Known limit: with no readable reply there is no usage to log.
  assertEquals(failed.seen.usage, [])
  for (const w of [cut, failed]) {
    assertEquals(w.seen.logs.length, 1)
    assertEquals(w.seen.logs.join(' ').includes('stick'), false)
    assertEquals(JSON.stringify(w.seen.usage).includes('stick'), false)
  }
})

Deno.test('other methods: OPTIONS answers the preflight, GET is refused', async () => {
  const w = world()
  assertEquals((await w.call(undefined, 'good', 'OPTIONS')).status, 200)
  assertEquals((await w.call(undefined, 'good', 'GET')).status, 405)
})
