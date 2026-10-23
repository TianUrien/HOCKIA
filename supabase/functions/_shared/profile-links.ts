// Hockia AI · profile builder links (handoff P0): YouTube / Vimeo become
// highlight videos (title + thumbnail via oEmbed), socials are kept as links
// only (never read), and other https pages (a club or league page) are read
// as text so career entries can be PROPOSED. Reading a page is the risky
// part: https only, public hosts only (no IPs / localhost / private ranges,
// checked again after DNS and on every redirect), small, fast, text only.

export type LinkKind = 'youtube' | 'vimeo' | 'social' | 'page' | 'invalid'
export const SOCIAL_HOSTS: Record<string, string> = {
  'instagram.com': 'instagram', 'tiktok.com': 'tiktok', 'facebook.com': 'facebook', 'fb.com': 'facebook',
  // Keys of profiles.social_links (client lib/socialLinks.ts): X is stored as `twitter`.
  'x.com': 'twitter', 'twitter.com': 'twitter', 'linkedin.com': 'linkedin',
}
export const LINKS_MAX = 5

function hostOf(u: URL): string { return u.hostname.toLowerCase().replace(/^www\.|^m\./, '') }

export function classifyLink(raw: string): { kind: LinkKind; url: string; platform?: string } {
  let u: URL
  try { u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`) } catch { return { kind: 'invalid', url: raw } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'invalid', url: raw }
  u.protocol = 'https:'
  const h = hostOf(u)
  if (h === 'youtu.be' || h === 'youtube.com' || h === 'music.youtube.com') return { kind: 'youtube', url: u.toString() }
  if (h === 'vimeo.com' || h === 'player.vimeo.com') return { kind: 'vimeo', url: u.toString() }
  const social = Object.keys(SOCIAL_HOSTS).find((s) => h === s || h.endsWith(`.${s}`))
  if (social) return { kind: 'social', url: u.toString(), platform: SOCIAL_HOSTS[social] }
  return { kind: 'page', url: u.toString() }
}

/** Hosts a server must never fetch: literals, localhost, private and link-local ranges. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return true
  if (h.includes(':')) return true // any IPv6 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  return isPrivateIPv4(h)
}

export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

/** Visible text of an HTML page: no scripts, styles or tags; whitespace collapsed. */
export function htmlToText(html: string, max = 12000): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
    .slice(0, max)
}

async function resolvesPublic(host: string): Promise<boolean> {
  try {
    const ips = await Deno.resolveDns(host, 'A')
    if (!ips.length) return false
    return ips.every((ip) => !isPrivateIPv4(ip))
  } catch {
    return false
  }
}

/** Read a public page as text, or null. Never throws. */
export async function readPublicPage(url: string, { timeoutMs = 8000, maxBytes = 600_000 } = {}): Promise<{ url: string; text: string } | null> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    let u: URL
    try { u = new URL(current) } catch { return null }
    if (u.protocol !== 'https:' || isBlockedHost(u.hostname) || !(await resolvesPublic(u.hostname))) return null
    let res: Response
    try {
      res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'HockiaProfileReader/1.0 (+https://www.inhockia.com)', Accept: 'text/html' } })
    } catch { return null }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel()
      if (!loc) return null
      current = new URL(loc, u).toString()
      continue
    }
    if (!res.ok || !/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '')) { await res.body?.cancel(); return null }
    const reader = res.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); break }
      chunks.push(value)
    }
    const html = new TextDecoder().decode(chunks.length === 1 ? chunks[0] : new Uint8Array(chunks.flatMap((c) => [...c])))
    const text = htmlToText(html)
    return text.length > 40 ? { url: u.toString(), text } : null
  }
  return null
}

/** Title and thumbnail of a YouTube / Vimeo video, or null. */
export async function oembed(kind: 'youtube' | 'vimeo', url: string): Promise<{ title: string; thumbnail_url: string | null } | null> {
  const endpoint = kind === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const j = await res.json() as { title?: unknown; thumbnail_url?: unknown }
    const title = typeof j.title === 'string' ? j.title.slice(0, 120) : ''
    return title ? { title, thumbnail_url: typeof j.thumbnail_url === 'string' && j.thumbnail_url.startsWith('https://') ? j.thumbnail_url : null } : null
  } catch {
    return null
  }
}
