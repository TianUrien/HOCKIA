// =========================================================================
// role-description-draft — "Draft it with Hockia AI" (Figma 04 Club 330:596)
// =========================================================================
// Drafts the "About the role" text from the answers to steps 1–2 of Post a
// role. The club edits it before posting; nothing is saved here. Club or
// coach callers only. If the model is unavailable (or the caller is over the
// hourly draft limit), a plain template built from the same answers is
// returned, so the button always fills the field. Model spend is logged to
// ai_usage_log.
//
// mode 'from_text' (Club speed CS1–CS2, Figma 05 204:892): { mode, text } →
// { draft } — one sentence becomes the structured fields of steps 1–3 via a
// forced tool call, validated against the form's vocabularies
// (_shared/role-draft-from-text.ts). Clubs only, its own daily limit
// (role_draft_text); it never uses the member's Hockia AI questions (those
// count nl-search only). No template fallback: { draft: null, reason } and
// the client starts from scratch with the sentence kept.
// =========================================================================

import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { type Answers, clean, facts, leagueForTeam, sanitizeAnswers, stripPlaceholders, template } from '../_shared/role-description-copy.ts'
import { checkUserRateLimit } from '../_shared/rate-limit.ts'
import { recordAiUsage } from '../_shared/aiUsage.ts'
import { captureException, setSentryUser } from '../_shared/sentry.ts'
import { cleanRoleText, ROLE_DRAFT_SYSTEM, ROLE_DRAFT_TOOL, validateRoleDraft } from '../_shared/role-draft-from-text.ts'

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-6'
const MAX_CHARS = 700
const DRAFT_LIMIT_PER_HOUR = 20
const ANTHROPIC_TIMEOUT_MS = 20_000
const FROM_TEXT_LIMIT_PER_DAY = 15

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
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
      .select('role, full_name, mens_league_division, womens_league_division')
      .eq('id', userId)
      .maybeSingle()
    const p = prof as { role?: string; full_name?: string | null; mens_league_division?: string | null; womens_league_division?: string | null } | null
    if (!p || (p.role !== 'club' && p.role !== 'coach')) return json({ error: 'forbidden' }, 403)

    let body: { answers?: unknown; mode?: unknown; text?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ error: 'invalid_body' }, 400)
    }
    if (body?.mode === 'from_text') {
      if (p.role !== 'club') return json({ error: 'forbidden' }, 403)
      return await draftFromText(supabase, userId, cleanRoleText(body.text), json)
    }
    const answers: Answers = sanitizeAnswers(body?.answers)
    const clubName = clean(p.full_name) || 'Our club'
    // The client sends the pill label ("Women's"), so normalise before choosing the league.
    const league = leagueForTeam(answers.team, p.mens_league_division, p.womens_league_division)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ description: template(answers, clubName), source: 'template' })

    const limit = await checkUserRateLimit(supabase, userId, 'role_draft', DRAFT_LIMIT_PER_HOUR, 3600)
    if (limit.error) console.warn('[role-description-draft] rate limit check failed', limit.error)
    if (!limit.allowed) return json({ description: template(answers, clubName), source: 'template' })

    let usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null = null
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 400,
          system: [{
            type: 'text',
            cache_control: { type: 'ephemeral' },
            text: [
              'You write the "About the role" text for a field hockey club posting a role on Hockia.',
              'Write as the club, first person plural ("we"), warm and plain. 3–5 short sentences, under 600 characters.',
              'Use ONLY the facts given. Never invent training days, facilities, salaries, results or promises.',
              'If a detail is missing, leave it out. Never write placeholders, brackets or blanks for the club to fill.',
              'Write the team naturally, e.g. "a midfielder for our men\'s team", never "a Men midfielder".',
              'No emoji, no hashtags, no headings, no bullet points.',
              'Reply with the text only.',
            ].join('\n'),
          }],
          messages: [{ role: 'user', content: facts(answers, clubName, league).join('\n') }],
        }),
        signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`anthropic ${res.status}`)
      const data = await res.json() as {
        content: Array<{ type: string; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
      }
      usage = data.usage ?? null
      const text = stripPlaceholders(data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim())
      if (!text || text.length > MAX_CHARS) throw new Error('empty or too long')
      return json({ description: text, source: 'ai' })
    } catch (err) {
      console.error('[role-description-draft]', String(err))
      return json({ description: template(answers, clubName), source: 'template' })
    } finally {
      if (usage) {
        await recordAiUsage(supabase, {
          user_id: userId,
          function: 'role-description-draft',
          provider: 'claude',
          model: MODEL,
          input_tokens: usage.input_tokens ?? null,
          output_tokens: usage.output_tokens ?? null,
          cached_tokens: usage.cache_read_input_tokens ?? null,
        })
      }
    }
  } catch (err) {
    console.error('[role-description-draft] unhandled', err)
    captureException(err, { functionName: 'role-description-draft' })
    return json({ error: 'internal_error' }, 500)
  }
})

type Json = (body: unknown, status?: number) => Response

async function draftFromText(supabase: ReturnType<typeof getServiceClient>, userId: string, text: string, json: Json): Promise<Response> {
  if (text.length < 3) return json({ error: 'text_required' }, 400)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ draft: null, reason: 'unavailable' })
  const limit = await checkUserRateLimit(supabase, userId, 'role_draft_text', FROM_TEXT_LIMIT_PER_DAY, 86_400)
  if (limit.error) console.warn('[role-description-draft] from_text rate limit check failed', limit.error)
  if (!limit.allowed) return json({ draft: null, reason: 'limit' })

  const today = new Date()
  let usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null = null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: [{ type: 'text', cache_control: { type: 'ephemeral' }, text: ROLE_DRAFT_SYSTEM }],
        tools: [ROLE_DRAFT_TOOL],
        tool_choice: { type: 'tool', name: ROLE_DRAFT_TOOL.name },
        messages: [{ role: 'user', content: `Today is ${today.toISOString().slice(0, 10)}.\nThe club wrote:\n"""${text}"""` }],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}`)
    const data = await res.json() as {
      content: Array<{ type: string; name?: string; input?: unknown }>
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
    }
    usage = data.usage ?? null
    const call = data.content.find((c) => c.type === 'tool_use' && c.name === ROLE_DRAFT_TOOL.name)
    if (!call) throw new Error('no tool call')
    return json({ draft: validateRoleDraft(call.input, today), source: 'ai' })
  } catch (err) {
    console.error('[role-description-draft] from_text', String(err))
    return json({ draft: null, reason: 'unavailable' })
  } finally {
    if (usage) {
      await recordAiUsage(supabase, {
        user_id: userId,
        function: 'role-description-draft',
        provider: 'claude',
        model: MODEL,
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
        cached_tokens: usage.cache_read_input_tokens ?? null,
      })
    }
  }
}
