import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { getCorsHeaders } from './cors.ts'

const allowed = (origin: string) => getCorsHeaders(origin)['Access-Control-Allow-Origin'] === origin

Deno.test('cors: web, preview and native shells are allowed', () => {
  for (const o of ['https://www.inhockia.com', 'https://staging.inhockia.com', 'http://localhost:5173', 'https://hockia-git-x.vercel.app', 'hockia://app.inhockia.com', 'https://app.inhockia.com', 'capacitor://localhost']) {
    assertEquals(allowed(o), true, o)
  }
})

Deno.test('cors: the shipped Android WebView origin https://localhost is allowed (2026-10-17)', () => {
  assertEquals(allowed('https://localhost'), true)
})

Deno.test('cors: unknown origins and other localhost ports are not echoed', () => {
  for (const o of ['https://evil.example', 'https://localhost:8443', 'http://localhost:5201', 'https://localhost.evil.example']) {
    assertEquals(allowed(o), false, o)
  }
})
