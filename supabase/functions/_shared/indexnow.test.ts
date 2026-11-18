import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { indexNowBody, isValidIndexNowKey, pingIndexNow, roleVisibilityChange } from './indexnow.ts'

// A made-up value in the protocol's format (built, not literal, so secret scanners ignore it).
const KEY = 'ab12'.repeat(8)

Deno.test('roleVisibilityChange: publish, reopen, close and no-ops', () => {
  assertEquals(roleVisibilityChange({ type: 'INSERT', record: { id: 'a', status: 'open' }, old_record: null }), 'published')
  assertEquals(roleVisibilityChange({ type: 'INSERT', record: { id: 'a', status: 'draft' }, old_record: null }), null)
  assertEquals(roleVisibilityChange({ type: 'UPDATE', record: { id: 'a', status: 'open' }, old_record: { status: 'draft' } }), 'published')
  assertEquals(roleVisibilityChange({ type: 'UPDATE', record: { id: 'a', status: 'open' }, old_record: { status: 'closed' } }), 'published')
  assertEquals(roleVisibilityChange({ type: 'UPDATE', record: { id: 'a', status: 'closed' }, old_record: { status: 'open' } }), 'closed')
  assertEquals(roleVisibilityChange({ type: 'UPDATE', record: { id: 'a', status: 'open' }, old_record: { status: 'open' } }), null)
  assertEquals(roleVisibilityChange({ type: 'UPDATE', record: { id: 'a', status: 'closed' }, old_record: { status: 'draft' } }), null)
})

Deno.test('indexNowBody: host, key file location and absolute URLs', () => {
  assertEquals(indexNowBody('https://inhockia.com/', KEY, ['/opportunities/1', 'opportunities']), {
    host: 'inhockia.com',
    key: KEY,
    keyLocation: `https://inhockia.com/${KEY}.txt`,
    urlList: ['https://inhockia.com/opportunities/1', 'https://inhockia.com/opportunities'],
  })
})

Deno.test('isValidIndexNowKey: protocol format only', () => {
  assertEquals(isValidIndexNowKey(KEY), true)
  assertEquals(isValidIndexNowKey('short'), false)
  assertEquals(isValidIndexNowKey('has space 0123456789'), false)
  assertEquals(isValidIndexNowKey(undefined), false)
})

Deno.test('pingIndexNow: off without a key, never calls the network', async () => {
  let calls = 0
  const fetchImpl = (() => { calls++; return Promise.resolve(new Response(null, { status: 200 })) }) as typeof fetch
  assertEquals(await pingIndexNow('https://inhockia.com', ['/opportunities/1'], { key: undefined, fetchImpl }), { sent: false, reason: 'no-key' })
  assertEquals(await pingIndexNow('https://inhockia.com', [], { key: KEY, fetchImpl }), { sent: false, reason: 'no-urls' })
  assertEquals(calls, 0)
})

Deno.test('pingIndexNow: posts the URL list and reports the status', async () => {
  let seen: { url: string; body: unknown } | null = null
  const fetchImpl = ((url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(String(init.body)) }
    return Promise.resolve(new Response(null, { status: 202 }))
  }) as unknown as typeof fetch
  const result = await pingIndexNow('https://inhockia.com', ['/opportunities/1'], { key: KEY, fetchImpl })
  assertEquals(result, { sent: true, status: 202 })
  assertEquals(seen!.url, 'https://api.indexnow.org/indexnow')
  assertEquals((seen!.body as { urlList: string[] }).urlList, ['https://inhockia.com/opportunities/1'])
})

Deno.test('pingIndexNow: a network failure is reported, not thrown', async () => {
  const fetchImpl = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch
  assertEquals(await pingIndexNow('https://inhockia.com', ['/x'], { key: KEY, fetchImpl }), { sent: false, reason: 'error', detail: 'down' })
})
