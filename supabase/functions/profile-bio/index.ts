// =========================================================================
// profile-bio — Hockia AI "Improve my bio" (next steps, 2026-10-18)
// =========================================================================
// POST { focus: 'experience' | 'next' | 'style' | 'custom', note? } →
// { drafts: [{ angle, bio }] } — the first is the recommended one. Written
// only from the member's own profile facts (_shared/profile-bio.ts). Nothing
// is saved here: the member picks, edits and taps Save.
// Players and coaches; its own daily limit (profile_bio, 10/day); usage in
// ai_usage_log. It never uses the member's Hockia AI questions.
// =========================================================================

import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { checkUserRateLimit } from '../_shared/rate-limit.ts'
import { recordAiUsage } from '../_shared/aiUsage.ts'
import { captureException, setSentryUser } from '../_shared/sentry.ts'
import { BIO_FOCI, FOCUS_BRIEF, NOTE_MAX, PROFILE_BIO_SYSTEM, PROFILE_BIO_TOOL, bioFactLines, validateBioDrafts, yearsSpan, type BioFocus } from '../_shared/profile-bio.ts'

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-6'
const LIMIT_PER_DAY = 10
const TIMEOUT_MS = 30_000

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const supabase = getServiceClient()
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const { data: userData } = jwt ? await supabase.auth.getUser(jwt) : { data: { user: null } }
    const userId = userData?.user?.id
    if (!userId) return json({ error: 'auth_required' }, 401)
    setSentryUser(userId)

    let body: { focus?: unknown; note?: unknown }
    try { body = await req.json() } catch { return json({ error: 'invalid_body' }, 400) }
    const focus: BioFocus = BIO_FOCI.includes(body.focus as BioFocus) ? body.focus as BioFocus : 'experience'
    const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : ''
    if (focus === 'custom' && !note) return json({ error: 'note_required' }, 400)

    const { data: prof } = await supabase
      .from('profiles')
      .select('role, bio, position, secondary_position, playing_category, coach_specialization, base_location, languages, open_to_play, open_to_coach, nationality_country_id, nationality2_country_id')
      .eq('id', userId)
      .maybeSingle()
    const p = prof as { role?: string; bio?: string | null; position?: string | null; secondary_position?: string | null; playing_category?: string | null; coach_specialization?: string | null; base_location?: string | null; languages?: string[] | null; open_to_play?: boolean; open_to_coach?: boolean; nationality_country_id?: number | null; nationality2_country_id?: number | null } | null
    if (!p || (p.role !== 'player' && p.role !== 'coach')) return json({ error: 'forbidden' }, 403)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ drafts: [], reason: 'unavailable' })
    const limit = await checkUserRateLimit(supabase, userId, 'profile_bio', LIMIT_PER_DAY, 86_400)
    if (limit.error) console.warn('[profile-bio] rate limit check failed', limit.error)
    if (!limit.allowed) return json({ drafts: [], reason: 'limit' })

    const countryIds = [p.nationality_country_id, p.nationality2_country_id].filter((x): x is number => typeof x === 'number')
    const [{ data: countries }, { data: career }] = await Promise.all([
      countryIds.length ? supabase.from('countries').select('id, name, common_name').in('id', countryIds) : Promise.resolve({ data: [] }),
      supabase.from('career_history').select('club_name, division_league, position_role, start_date, end_date').eq('user_id', userId).order('start_date', { ascending: false, nullsFirst: false }).limit(8),
    ])
    const facts = bioFactLines({
      role: p.role,
      position: p.position, secondary_position: p.secondary_position,
      playing_category: p.playing_category, coach_specialization: p.coach_specialization,
      base_location: p.base_location,
      nationalities: ((countries ?? []) as { common_name: string | null; name: string }[]).map((c) => c.common_name || c.name),
      languages: (p.languages ?? []).filter(Boolean).slice(0, 5),
      open_to: [p.open_to_play && 'joining a new club', p.open_to_coach && 'coaching roles'].filter(Boolean) as string[],
      current_bio: p.bio,
      career: ((career ?? []) as { club_name: string; division_league: string | null; position_role: string | null; start_date: string | null; end_date: string | null }[])
        .map((c) => ({ club: c.club_name, league: c.division_league, role: c.position_role, years: yearsSpan(c.start_date, c.end_date) })),
    })
    const prompt = `Focus: ${FOCUS_BRIEF[focus]}${note ? `\nThe member's instruction: """${note}"""` : ''}\n\nFacts:\n${facts}`

    type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
    let usage: Usage | null = null
    let raw: unknown
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 900,
          system: [{ type: 'text', cache_control: { type: 'ephemeral' }, text: PROFILE_BIO_SYSTEM }],
          tools: [PROFILE_BIO_TOOL],
          tool_choice: { type: 'tool', name: PROFILE_BIO_TOOL.name },
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const data = await res.json() as { content: Array<{ type: string; name?: string; input?: unknown }>; usage?: Usage }
      usage = data.usage ?? null
      raw = data.content.find((c) => c.type === 'tool_use' && c.name === PROFILE_BIO_TOOL.name)?.input
      if (!raw) throw new Error('no tool call')
    } catch (err) {
      console.error('[profile-bio] model', String(err))
      return json({ drafts: [], reason: 'unavailable' })
    } finally {
      if (usage) await recordAiUsage(supabase, { user_id: userId, function: 'profile-bio', provider: 'claude', model: MODEL, input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null, cached_tokens: usage.cache_read_input_tokens ?? null })
    }

    const drafts = validateBioDrafts(raw)
    // Counts only, never the text: a member's bio stays out of the logs.
    if (!drafts.length) console.warn('[profile-bio] every draft broke a rule', { keys: raw && typeof raw === 'object' ? Object.keys(raw as object).join(',') : typeof raw })
    return json(drafts.length ? { drafts } : { drafts: [], reason: 'unavailable' })
  } catch (err) {
    captureException(err, { functionName: 'profile-bio' })
    console.error('[profile-bio]', String(err))
    return json({ error: 'internal' }, 500)
  }
})
