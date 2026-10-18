import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { classifyLink, htmlToText, isBlockedHost, isPrivateIPv4 } from './profile-links.ts'

Deno.test('links are sorted into videos, socials and pages', () => {
  assertEquals(classifyLink('youtu.be/abc').kind, 'youtube')
  assertEquals(classifyLink('https://www.youtube.com/watch?v=abc').kind, 'youtube')
  assertEquals(classifyLink('https://vimeo.com/123').kind, 'vimeo')
  assertEquals(classifyLink('https://instagram.com/flor').platform, 'instagram')
  assertEquals(classifyLink('https://m.facebook.com/x').platform, 'facebook')
  assertEquals(classifyLink('http://clubdecampo.es/hockey').kind, 'page')
  assertEquals(classifyLink('http://clubdecampo.es/hockey').url.startsWith('https://'), true)
  assertEquals(classifyLink('javascript:alert(1)').kind, 'invalid')
})

Deno.test('the page reader refuses private and local hosts', () => {
  for (const h of ['localhost', 'api.localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '[::1]', 'intranet', 'db.internal', 'printer.local']) assertEquals(isBlockedHost(h), true, h)
  for (const h of ['clubdecampo.es', 'www.hockey.org.ar', '8.8.8.8']) assertEquals(isBlockedHost(h), false, h)
  assertEquals(isPrivateIPv4('100.64.0.1'), true)
  assertEquals(isPrivateIPv4('203.0.113.9'), false)
})

Deno.test('pages are read as visible text only', () => {
  const t = htmlToText('<html><head><style>a{}</style><script>evil()</script></head><body><h1>Club de Campo</h1><p>Plantel 2023 &amp; 2024</p></body></html>')
  assertEquals(t.includes('evil'), false)
  assertEquals(t.includes('Club de Campo'), true)
  assertEquals(t.includes('Plantel 2023 & 2024'), true)
})
