// =========================================================================
// apply-draft — Hockia AI "Prepare my application" (handoff A4, 175:222)
// =========================================================================
// POST { opportunity_id } → { note, source } | { state: 'already_applied' }
// A short note to the club from the member's OWN profile facts (players and
// coaches). It writes nothing: the client shows the draft card and sends the
// application only when the member taps "Send application", through the
// same insert and eligibility trigger as the Apply sheet. Model unavailable
// or over the limit → a plain template from the same facts.
// Ruling 2026-10-18: Hockia AI drafts, the member edits.
// =========================================================================

import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { checkUserRateLimit } from '../_shared/rate-limit.ts'
import { recordAiUsage } from '../_shared/aiUsage.ts'
import { captureException, setSentryUser } from '../_shared/sentry.ts'
import { roleOrganisationName } from '../_shared/role-organisation.ts'
import { APPLY_NOTE_SYSTEM, cleanNote, factLines, templateNote, type ApplyFacts, type RoleFacts } from '../_shared/apply-note.ts'

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-6'
const LIMIT_PER_DAY = 20
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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

    let oppId = ''
    try { oppId = String(((await req.json()) as { opportunity_id?: unknown }).opportunity_id ?? '') } catch { return json({ error: 'invalid_body' }, 400) }
    if (!/^[0-9a-f-]{36}$/i.test(oppId)) return json({ error: 'invalid_body' }, 400)

    const [{ data: prof }, { data: opp }, { data: existing }] = await Promise.all([
      supabase.from('profiles').select('role, full_name, position, secondary_position, nationality_country_id, nationality2_country_id, available_from, current_club, accepted_reference_count, highlight_video_url').eq('id', userId).maybeSingle(),
      supabase.from('opportunities').select('id, title, position, opportunity_type, status, location_city, eu_passport_required, club_id, organization_name, world_club_id').eq('id', oppId).maybeSingle(),
      supabase.from('opportunity_applications').select('id, applied_at').eq('opportunity_id', oppId).eq('applicant_id', userId).maybeSingle(),
    ])
    const p = prof as Record<string, unknown> | null
    const o = opp as Record<string, unknown> | null
    if (!p || (p.role !== 'player' && p.role !== 'coach')) return json({ error: 'forbidden' }, 403)
    if (!o || o.status !== 'open') return json({ error: 'not_open' }, 404)
    if (existing) return json({ state: 'already_applied', applied_at: (existing as { applied_at: string }).applied_at })

    // Club name the way the role page shows it.
    const { data: pub } = await supabase.from('profiles').select('full_name, role, current_club, current_world_club_id').eq('id', o.club_id as string).maybeSingle()
    const pubRow = pub as { full_name: string | null; role: string | null; current_club: string | null; current_world_club_id: string | null } | null
    const worldIds = [o.world_club_id, pubRow?.current_world_club_id].filter((x): x is string => typeof x === 'string')
    const worldNames = new Map<string, string>()
    if (worldIds.length) {
      const { data: wc } = await supabase.from('world_clubs').select('id, club_name').in('id', worldIds)
      for (const c of (wc ?? []) as { id: string; club_name: string }[]) worldNames.set(c.id, c.club_name)
    }
    const club = roleOrganisationName({
      publisherRole: pubRow?.role ?? null,
      publisherName: pubRow?.full_name ?? null,
      publisherCurrentClub: pubRow?.current_club ?? null,
      organizationName: (o.organization_name as string | null) ?? null,
      roleWorldClubName: o.world_club_id ? worldNames.get(o.world_club_id as string) ?? null : null,
      publisherWorldClubName: pubRow?.current_world_club_id ? worldNames.get(pubRow.current_world_club_id) ?? null : null,
    }) ?? 'the club'

    const ids = [p.nationality_country_id, p.nationality2_country_id].filter((x): x is number => typeof x === 'number')
    const { data: cs } = ids.length ? await supabase.from('countries').select('id, name, common_name, code').in('id', ids) : { data: [] }
    const passports = ((cs ?? []) as { name: string; common_name: string | null; code: string }[]).map((c) => ({ name: c.common_name || c.name, eu: EU.has(c.code) }))
    const { data: career } = await supabase.from('career_history').select('club_name, years, division_league, start_date').eq('user_id', userId).order('start_date', { ascending: false, nullsFirst: false }).limit(4)
    const af = typeof p.available_from === 'string' ? new Date(p.available_from) : null
    const facts: ApplyFacts = {
      firstName: typeof p.full_name === 'string' ? p.full_name.trim().split(/\s+/)[0] || null : null,
      role: p.role as 'player' | 'coach',
      position: (p.position as string | null) ?? null,
      secondary: (p.secondary_position as string | null) ?? null,
      passports,
      availableFrom: af && !Number.isNaN(af.getTime()) && af > new Date() ? `${MONTHS[af.getUTCMonth()]} ${af.getUTCFullYear()}` : null,
      currentClub: (p.current_club as string | null) || null,
      career: ((career ?? []) as { club_name: string; years: string | null; division_league: string | null }[]).map((c) => ({ club: c.club_name, years: c.years || null, league: c.division_league || null })),
      references: typeof p.accepted_reference_count === 'number' ? p.accepted_reference_count : 0,
      hasVideo: Boolean(p.highlight_video_url),
    }
    const role: RoleFacts = { club, title: String(o.title ?? 'this role'), position: (o.position as string | null) ?? null, euRequired: o.eu_passport_required === true, city: (o.location_city as string | null) ?? null }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ note: templateNote(facts, role), source: 'template' })
    const limit = await checkUserRateLimit(supabase, userId, 'apply_draft', LIMIT_PER_DAY, 86_400)
    if (limit.error) console.warn('[apply-draft] rate limit check failed', limit.error)
    if (!limit.allowed) return json({ note: templateNote(facts, role), source: 'template' })

    const meter: { usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null } = { usage: null }
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 300,
          system: [{ type: 'text', cache_control: { type: 'ephemeral' }, text: APPLY_NOTE_SYSTEM }],
          messages: [{ role: 'user', content: factLines(facts, role).join('\n') }],
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json() as { content: Array<{ type: string; text?: string }>; usage?: typeof meter.usage }
      meter.usage = data.usage ?? null
      const note = cleanNote(data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''))
      return json(note ? { note, source: 'ai' } : { note: templateNote(facts, role), source: 'template' })
    } catch (err) {
      console.error('[apply-draft] model', String(err))
      return json({ note: templateNote(facts, role), source: 'template' })
    } finally {
      const u = meter.usage
      if (u) await recordAiUsage(supabase, { user_id: userId, function: 'apply-draft', provider: 'claude', model: MODEL, input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null, cached_tokens: u.cache_read_input_tokens ?? null })
    }
  } catch (err) {
    console.error('[apply-draft] unhandled', err)
    captureException(err, { functionName: 'apply-draft' })
    return json({ error: 'internal_error' }, 500)
  }
})
