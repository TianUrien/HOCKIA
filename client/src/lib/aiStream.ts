import { supabase, SUPABASE_URL_FOR_STREAM, SUPABASE_ANON_KEY_FOR_STREAM } from '@/lib/supabase'

/** A live step from nl-search (Hockia AI sheet, 2026-10-17). */
export interface AiStep { id: string; label: string; state: 'now' | 'done' }

export interface StreamResult {
  data: unknown
  error: { message: string; status: number } | null
}

/** Fold one step event into the visible list: a new id is appended, a known id updated. */
export function applyStep(steps: AiStep[], e: AiStep): AiStep[] {
  const i = steps.findIndex((s) => s.id === e.id)
  if (i === -1) return [...steps, e]
  const next = steps.slice()
  next[i] = { ...next[i], ...e }
  return next
}

/** Every step reads done once the answer is in. */
export function allDone(steps: AiStep[]): AiStep[] {
  return steps.map((s) => (s.state === 'done' ? s : { ...s, state: 'done' }))
}

/** Parse a Server-Sent Events buffer: complete events out, the incomplete tail back. */
export function parseSse(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  const events = parts.flatMap((block) => {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    return data.length ? [{ event, data: data.join('\n') }] : []
  })
  return { events, rest }
}

async function once(body: Record<string, unknown>, onStep: (s: AiStep) => void): Promise<StreamResult> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${SUPABASE_URL_FOR_STREAM}/functions/v1/nl-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      apikey: SUPABASE_ANON_KEY_FOR_STREAM,
      Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY_FOR_STREAM}`,
    },
    body: JSON.stringify(body),
  })
  const type = res.headers.get('content-type') ?? ''
  // A function without the stream mode (or an early auth / rate-limit refusal) answers JSON.
  if (!type.includes('text/event-stream') || !res.body) {
    let json: unknown = null
    try { json = await res.json() } catch { /* empty body */ }
    if (!res.ok) return { data: null, error: { message: (json as { error?: string } | null)?.error || `Search failed (${res.status})`, status: res.status } }
    return { data: json, error: null }
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const { events, rest } = parseSse(buf)
    buf = rest
    for (const ev of events) {
      if (ev.event === 'step') {
        try { onStep(JSON.parse(ev.data) as AiStep) } catch { /* malformed step: ignore */ }
      } else if (ev.event === 'result') {
        const r = JSON.parse(ev.data) as { status: number; body: unknown }
        if (r.status >= 400) return { data: null, error: { message: (r.body as { error?: string } | null)?.error || `Search failed (${r.status})`, status: r.status } }
        return { data: r.body, error: null }
      }
    }
  }
  return { data: null, error: { message: 'The connection closed before the answer arrived', status: 0 } }
}

/**
 * nl-search with live steps (Server-Sent Events). Same body and same JSON
 * envelope as `supabase.functions.invoke('nl-search')`; refreshes the session
 * once on a 401 and retries, like invokeNlSearch.
 */
export async function streamNlSearch(body: Record<string, unknown>, onStep: (s: AiStep) => void): Promise<StreamResult> {
  let res = await once(body, onStep)
  if (res.error?.status === 401) {
    await supabase.auth.refreshSession().catch(() => undefined)
    res = await once(body, onStep)
  }
  return res
}
