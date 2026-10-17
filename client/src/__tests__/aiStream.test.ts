import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: {}, SUPABASE_URL_FOR_STREAM: 'https://x.test', SUPABASE_ANON_KEY_FOR_STREAM: 'anon' }))
import { allDone, applyStep, parseSse } from '@/lib/aiStream'

// Hockia AI live steps (2026-10-17): the nl-search event stream.
describe('nl-search event stream', () => {
  it('parses complete events, skips pings and keeps the unfinished tail', () => {
    const buf = 'event: step\ndata: {"id":"profile","label":"Read your profile","state":"done"}\n\n: ping\n\nevent: result\ndata: {"status":200,"body":{"success":true}}\n\nevent: step\ndata: {"id":"x"'
    const { events, rest } = parseSse(buf)
    expect(events.map((e) => e.event)).toEqual(['step', 'result'])
    expect(JSON.parse(events[1].data)).toEqual({ status: 200, body: { success: true } })
    expect(rest).toBe('event: step\ndata: {"id":"x"')
  })

  it('a new step is appended, a known step updated in place, and the answer marks every step done', () => {
    let steps = applyStep([], { id: 'search', label: 'Searching profiles', state: 'now' })
    steps = applyStep(steps, { id: 'write', label: 'Writing your answer', state: 'now' })
    steps = applyStep(steps, { id: 'search', label: 'Found 4 matching profiles', state: 'done' })
    expect(steps).toEqual([
      { id: 'search', label: 'Found 4 matching profiles', state: 'done' },
      { id: 'write', label: 'Writing your answer', state: 'now' },
    ])
    expect(allDone(steps).every((s) => s.state === 'done')).toBe(true)
  })
})
