// =========================================================================
// role-description-draft — "Draft it with Hockia AI" (Figma 04 Club 330:596)
// =========================================================================
// Drafts the "About the role" text from the answers to steps 1–2 of Post a
// role. The club edits it before posting; nothing is saved here. Club or
// coach callers only. If the model is unavailable (or the caller is over the
// hourly draft limit), a plain template built from the same answers is
// returned, so the button always fills the field. Model spend is logged to
// ai_usage_log.
// =========================================================================

import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { type Answers, clean, facts, leagueForTeam, sanitizeAnswers, stripPlaceholders, template } from '../_shared/role-description-copy.ts'
import { checkUserRateLimit } from '../_shared/rate-limit.ts'
import { recordAiUsage } from '../_shared/aiUsage.ts'
import { captureException, setSentryUser } from '../_shared/sentry.ts'

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-6'
const MAX_CHARS = 700
const DRAFT_LIMIT_PER_HOUR = 20
const ANTHROPIC_TIMEOUT_MS = 20_000

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

    let answers: Answers
    try {
      answers = sanitizeAnswers(((await req.json()) as { answers?: unknown }).answers)
    } catch {
      return json({ error: 'invalid_body' }, 400)
    }
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
