import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import handler from '../../api/indexnow-key'

// A made-up value in the expected format (built, not literal, so secret scanners ignore it).
const KEY = 'ab12'.repeat(8)
const ask = (key: string) => handler(new Request(`https://inhockia.com/api/indexnow-key?key=${key}`))

describe('IndexNow key file', () => {
  afterEach(() => { delete process.env.INDEXNOW_KEY })

  it('is a 404 while no key is configured', async () => {
    expect(ask(KEY).status).toBe(404)
  })

  it('returns the configured key as plain text, and only for that key', async () => {
    process.env.INDEXNOW_KEY = KEY
    const ok = ask(KEY)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await ok.text()).toBe(KEY)
    expect(ask('f'.repeat(32)).status).toBe(404)
    expect(ask('').status).toBe(404)
  })

  it('is routed before the app shell fallback', () => {
    const vercel = JSON.parse(readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')) as { rewrites: { source: string; destination: string }[] }
    const own = vercel.rewrites.findIndex((r) => r.destination === '/api/indexnow-key?key=:key')
    const shell = vercel.rewrites.findIndex((r) => r.destination === '/app.html')
    expect(own).toBeGreaterThan(-1)
    expect(own).toBeLessThan(shell)
  })
})
