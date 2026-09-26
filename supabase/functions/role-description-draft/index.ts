// =========================================================================
// role-description-draft — "Draft it with Hockia AI" (Figma 04 Club 330:596)
// =========================================================================
// Drafts the "About the role" text from the answers to steps 1–2 of Post a
// role. The club edits it before posting; nothing is saved here. Club or
// coach callers only. If the model is unavailable, a plain template built
// from the same answers is returned, so the button always fills the field.
// =========================================================================

import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { type Answers, clean, facts, stripPlaceholders, template } from '../_shared/role-description-copy.ts'

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-6'
const MAX_CHARS = 700

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabase = getServiceClient()
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data: userData } = jwt ? await supabase.auth.getUser(jwt) : { data: { user: null } }
  const userId = userData?.user?.id
  if (!userId) return json({ error: 'auth_required' }, 401)
  const { data: prof } = await supabase
    .from('profiles')
    .select('role, full_name, mens_league_division, womens_league_division')
    .eq('id', userId)
    .maybeSingle()
  const p = prof as { role?: string; full_name?: string | null; mens_league_division?: string | null; womens_league_division?: string | null } | null
  if (!p || (p.role !== 'club' && p.role !== 'coach')) return json({ error: 'forbidden' }, 403)

  let answers: Answers
  try {
    answers = ((await req.json()) as { answers?: Answers }).answers ?? {}
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const clubName = clean(p.full_name) || 'Our club'
  const team = clean(answers.team).toLowerCase()
  const league = (team === 'women' || team === 'girls' ? p.womens_league_division : p.mens_league_division)?.trim() || null

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ description: template(answers, clubName), source: 'template' })
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
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}`)
    const data = await res.json() as { content: Array<{ type: string; text?: string }> }
    const text = stripPlaceholders(data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim())
    if (!text || text.length > MAX_CHARS) throw new Error('empty or too long')
    return json({ description: text, source: 'ai' })
  } catch (err) {
    console.error('[role-description-draft]', String(err))
    return json({ description: template(answers, clubName), source: 'template' })
  }
})
