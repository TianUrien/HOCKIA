// =========================================================================
// campaign-draft — "Write a campaign with Hockia AI" (founder 2026-11-21)
// =========================================================================
// { text } → { draft } — one sentence from a brand becomes the fields of a
// campaign (objective, title, body, need, roles, place, perk) through a tool
// call, validated against the editor's vocabularies and limits
// (_shared/campaign-draft-from-text.ts). The request itself lives in
// _shared/campaign-draft-handler.ts, where the deno suite runs it with the
// model call replaced; this file wires the real client, key and fetch.
//
// Brands only, its own daily limit (campaign_draft_text, fail closed); it
// never uses the member's Hockia AI questions (those count nl-search only).
// Nothing is saved or published here: the client shows the draft, and the
// brand continues in the editor, where the photo, the link and the dates are
// added. The draft is written in the language of the brand's sentence, not
// the interface language, so a perk stays in the brand's own words.
//
// No template fallback: { draft: null, reason } ('unavailable' | 'limit')
// and the client opens the editor with the sentence kept. Model spend is
// logged to ai_usage_log whenever the model's reply could be read; a call
// that times out or fails before a reply is not logged (no usage to read).
// =========================================================================

import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { checkUserRateLimit } from '../_shared/rate-limit.ts'
import { recordAiUsage } from '../_shared/aiUsage.ts'
import { captureException, setSentryUser } from '../_shared/sentry.ts'
import { CAMPAIGN_DRAFT_LIMIT_PER_DAY, handleCampaignDraft } from '../_shared/campaign-draft-handler.ts'

const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-6'

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('Origin'))
  try {
    const supabase = getServiceClient()
    return await handleCampaignDraft(req, {
      cors,
      apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
      model: MODEL,
      fetch,
      userIdFromToken: async (jwt) => {
        const { data } = await supabase.auth.getUser(jwt)
        const id = data?.user?.id ?? null
        if (id) setSentryUser(id)
        return id
      },
      profile: async (userId) => {
        const { data } = await supabase.from('profiles').select('role, is_blocked').eq('id', userId).maybeSingle()
        return data as { role?: string; is_blocked?: boolean | null } | null
      },
      takeSlot: (userId) => checkUserRateLimit(supabase, userId, 'campaign_draft_text', CAMPAIGN_DRAFT_LIMIT_PER_DAY, 86_400, 'closed'),
      recordUsage: (row) => recordAiUsage(supabase, row),
    })
  } catch (err) {
    console.error('[campaign-draft] unhandled', err instanceof Error ? err.message : String(err))
    captureException(err, { functionName: 'campaign-draft' })
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
