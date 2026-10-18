// =========================================================================
// profile-builder — Hockia AI "Fill my profile for me" (handoff P0–P3)
// =========================================================================
// POST { text?, links?: string[], cv?: { base64, name }, photos?: [{ index,
// base64 }] } → { draft, steps } — PROPOSALS ONLY. The member writes their
// career in their own words, attaches a CV (PDF), links and photos; one forced
// tool call reads it all; everything is validated and matched here (club
// directory, countries, what the profile already has). Nothing is written:
// the client saves only what the member keeps, after "Save all".
//
// Rulings 2026-10-18: players and coaches; passports fill EMPTY slots only;
// a date of birth only when none is set and never under 18 from the chat;
// identity documents are never accepted (photos showing one are dropped).
// Its own daily limit (profile_builder), usage in ai_usage_log; it never uses
// the member's Hockia AI questions.
// =========================================================================

import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { checkUserRateLimit } from '../_shared/rate-limit.ts'
import { recordAiUsage } from '../_shared/aiUsage.ts'
import { captureException, setSentryUser } from '../_shared/sentry.ts'
import { ageOn, normalizeClub, PROFILE_DRAFT_SYSTEM, PROFILE_DRAFT_TOOL, seasonDate, TEXT_MAX, validateProfileDraft, yearsLabel } from '../_shared/profile-draft.ts'
import { classifyLink, LINKS_MAX, oembed, readPublicPage } from '../_shared/profile-links.ts'

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-6'
const LIMIT_PER_DAY = 10
const CV_MAX_BYTES = 4 * 1024 * 1024
const PHOTO_MAX = 6
const PHOTO_MAX_BYTES = 400 * 1024
const TIMEOUT_MS = 60_000

type Json = (body: unknown, status?: number) => Response
const b64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4)

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('Origin'))
  const json: Json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const supabase = getServiceClient()
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const { data: userData } = jwt ? await supabase.auth.getUser(jwt) : { data: { user: null } }
    const userId = userData?.user?.id
    if (!userId) return json({ error: 'auth_required' }, 401)
    setSentryUser(userId)

    const { data: prof } = await supabase
      .from('profiles')
      .select('role, date_of_birth, nationality_country_id, nationality2_country_id, position, secondary_position, highlight_video_url, social_links')
      .eq('id', userId)
      .maybeSingle()
    const p = prof as { role?: string; date_of_birth?: string | null; nationality_country_id?: number | null; nationality2_country_id?: number | null; position?: string | null; secondary_position?: string | null; highlight_video_url?: string | null; social_links?: Record<string, unknown> | null } | null
    if (!p || (p.role !== 'player' && p.role !== 'coach')) return json({ error: 'forbidden' }, 403)

    let body: { text?: unknown; links?: unknown; cv?: { base64?: unknown; name?: unknown } | null; photos?: unknown }
    try { body = await req.json() } catch { return json({ error: 'invalid_body' }, 400) }
    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : ''
    const links = (Array.isArray(body.links) ? body.links : []).filter((l): l is string => typeof l === 'string').slice(0, LINKS_MAX).map(classifyLink).filter((l) => l.kind !== 'invalid')
    const cv = body.cv && typeof body.cv.base64 === 'string' && body.cv.base64.length > 100 ? body.cv.base64 : null
    if (cv && b64Bytes(cv) > CV_MAX_BYTES) return json({ error: 'cv_too_large' }, 413)
    const photos = (Array.isArray(body.photos) ? body.photos : []).slice(0, PHOTO_MAX).flatMap((x) => {
      const o = (x && typeof x === 'object' ? x : {}) as { index?: unknown; base64?: unknown; media_type?: unknown }
      const media_type = o.media_type === 'image/png' ? 'image/png' : 'image/jpeg'
      return typeof o.index === 'number' && typeof o.base64 === 'string' && o.base64.length > 100 && b64Bytes(o.base64) <= PHOTO_MAX_BYTES ? [{ index: o.index, base64: o.base64, media_type }] : []
    })
    if (!text && !links.length && !cv && !photos.length) return json({ error: 'nothing_to_read' }, 400)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ draft: null, reason: 'unavailable' })
    const limit = await checkUserRateLimit(supabase, userId, 'profile_builder', LIMIT_PER_DAY, 86_400)
    if (limit.error) console.warn('[profile-builder] rate limit check failed', limit.error)
    if (!limit.allowed) return json({ draft: null, reason: 'limit' })

    // Links: videos (oEmbed) and socials are known without the model; pages are read as text for it.
    const videoLinks = links.filter((l) => l.kind === 'youtube' || l.kind === 'vimeo')
    const socials = links.filter((l) => l.kind === 'social').map((l) => ({ platform: l.platform as string, url: l.url }))
    const [videos, pages] = await Promise.all([
      Promise.all(videoLinks.map(async (l) => { const o = await oembed(l.kind as 'youtube' | 'vimeo', l.url); return o ? { url: l.url, provider: l.kind as 'youtube' | 'vimeo', ...o } : null })),
      Promise.all(links.filter((l) => l.kind === 'page').slice(0, 3).map((l) => readPublicPage(l.url))),
    ])
    const unreadPages = links.filter((l) => l.kind === 'page').length - pages.filter(Boolean).length

    // One forced tool call over everything the member sent.
    const content: unknown[] = []
    if (cv) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cv }, title: 'CV' })
    photos.forEach((ph) => content.push({ type: 'text', text: `Photo ${ph.index}:` }, { type: 'image', source: { type: 'base64', media_type: ph.media_type, data: ph.base64 } }))
    for (const pg of pages) if (pg) content.push({ type: 'text', text: `A public page the member linked (${pg.url}):\n"""${pg.text}"""` })
    content.push({ type: 'text', text: `Today is ${new Date().toISOString().slice(0, 10)}. The member is a ${p.role}.\n${text ? `They wrote:\n"""${text}"""` : 'They wrote nothing; read the attachments.'}` })

    type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
    const meter: { usage: Usage | null } = { usage: null }
    let raw: unknown
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1800,
          system: [{ type: 'text', cache_control: { type: 'ephemeral' }, text: PROFILE_DRAFT_SYSTEM }],
          tools: [PROFILE_DRAFT_TOOL],
          tool_choice: { type: 'tool', name: PROFILE_DRAFT_TOOL.name },
          messages: [{ role: 'user', content }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const data = await res.json() as { content: Array<{ type: string; name?: string; input?: unknown }>; usage?: Usage }
      meter.usage = data.usage ?? null
      raw = data.content.find((c) => c.type === 'tool_use' && c.name === PROFILE_DRAFT_TOOL.name)?.input
      if (!raw) throw new Error('no tool call')
    } catch (err) {
      console.error('[profile-builder] model', String(err))
      return json({ draft: null, reason: 'unavailable' })
    } finally {
      const u = meter.usage
      if (u) await recordAiUsage(supabase, { user_id: userId, function: 'profile-builder', provider: 'claude', model: MODEL, input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null, cached_tokens: u.cache_read_input_tokens ?? null })
    }

    const today = new Date()
    const d = validateProfileDraft(raw, today)

    // Countries (passports, club countries).
    const { data: countries } = await supabase.from('countries').select('id, name, common_name, nationality_name, code, flag_emoji')
    const C = (countries ?? []) as { id: number; name: string; common_name: string | null; nationality_name: string | null; code: string; flag_emoji: string | null }[]
    const findCountry = (n: string | null) => {
      if (!n) return null
      const k = n.toLowerCase().trim()
      return C.find((c) => [c.name, c.common_name, c.nationality_name].some((v) => v?.toLowerCase() === k)) ?? null
    }

    // Career: match the club directory strictly; skip what the profile already has.
    const { data: existing } = await supabase.from('career_history').select('club_name, world_club_id, start_date').eq('user_id', userId)
    const have = (existing ?? []) as { club_name: string; world_club_id: string | null; start_date: string | null }[]
    let matched = 0
    let duplicates = 0
    const career = []
    for (const [i, c] of d.career.entries()) {
      const country = findCountry(c.country)
      const { data: hits } = await supabase.rpc('search_world_clubs', { p_query: c.club_name, p_limit: 5, p_country_id: country?.id ?? undefined })
      const want = normalizeClub(c.club_name)
      const hit = ((hits ?? []) as { id: string; club_name: string; country_name: string | null }[]).find((h) => normalizeClub(h.club_name) === want) ?? null
      const start = seasonDate(c.start_year, c.start_month)
      const dup = have.some((h) => (hit && h.world_club_id === hit.id) || normalizeClub(h.club_name) === want) && (!start || have.some((h) => !h.start_date || h.start_date.slice(0, 4) === start.slice(0, 4)))
      if (dup) { duplicates += 1; continue }
      if (hit) matched += 1
      career.push({
        key: `c${i}`,
        club_name: hit?.club_name ?? c.club_name,
        world_club_id: hit?.id ?? null,
        matched: Boolean(hit),
        city: c.city,
        country: country?.name ?? c.country,
        league: c.league,
        role: c.role,
        start_date: start,
        end_date: c.current ? null : seasonDate(c.end_year, c.end_month),
        current: c.current,
        years: yearsLabel(c),
      })
    }

    // Passports: only empty slots, never one the profile already has.
    const owned = [p.nationality_country_id, p.nationality2_country_id].filter((x): x is number => typeof x === 'number')
    const free = 2 - owned.length
    const passports = d.passports.map(findCountry).filter((c): c is NonNullable<typeof c> => Boolean(c) && !owned.includes(c!.id)).slice(0, Math.max(0, free))
      .map((c) => ({ country_id: c.id, name: c.common_name || c.name, code: c.code, flag: c.flag_emoji }))

    // Date of birth: only when none is set; never under 18 from the chat.
    let date_of_birth: string | null = null
    let dob_note: 'already_set' | 'under_18' | null = null
    if (d.date_of_birth) {
      if (p.date_of_birth) dob_note = 'already_set'
      else if (ageOn(d.date_of_birth, today) < 18) dob_note = 'under_18'
      else date_of_birth = d.date_of_birth
    }

    const isPlayer = p.role === 'player'
    const position = isPlayer && !p.position ? d.position : null
    // Never offer the position the profile already has (as main) as the second one, or vice versa.
    const pickSecondary = d.secondary_position && d.secondary_position !== (position ?? p.position) ? d.secondary_position : null
    const secondary_position = isPlayer && !p.secondary_position ? pickSecondary : null
    const ownSocial = p.social_links && typeof p.social_links === 'object' ? p.social_links : {}
    const newSocials = socials.filter((s) => !(ownSocial as Record<string, unknown>)[s.platform])
    const photoResults = photos.map((ph) => ({ index: ph.index, ok: !d.idPhotos.includes(ph.index) }))
    const vids = videos.filter((v): v is NonNullable<typeof v> => Boolean(v))

    const steps: string[] = []
    if (d.career.length) steps.push(`Found ${d.career.length} ${d.career.length === 1 ? 'club' : 'clubs'} in what you sent`)
    if (career.length) steps.push(`Matched ${matched} of ${career.length} to the club directory`)
    if (duplicates) steps.push(`${duplicates} already on your profile`)
    if (cv) steps.push('Read your CV')
    if (vids.length) steps.push(`Found ${vids.length === 1 ? 'a video' : `${vids.length} videos`}`)
    if (pages.some(Boolean)) steps.push(`Read ${pages.filter(Boolean).length === 1 ? 'the page' : `${pages.filter(Boolean).length} pages`} you linked`)
    if (unreadPages) steps.push(`Couldn’t open ${unreadPages === 1 ? 'one link' : `${unreadPages} links`}`)
    if (photos.length) steps.push(`Checked ${photos.length === 1 ? 'the photo' : `the ${photos.length} photos`}`)

    return json({
      draft: { career, passports, date_of_birth, dob_note, position, secondary_position, videos: vids, socials: newSocials, photos: photoResults },
      steps,
    })
  } catch (err) {
    console.error('[profile-builder] unhandled', err)
    captureException(err, { functionName: 'profile-builder' })
    return json({ error: 'internal_error' }, 500)
  }
})
