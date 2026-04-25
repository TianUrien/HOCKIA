// deno-lint-ignore-file no-explicit-any
/**
 * LLM provider abstraction for natural language → structured filter parsing.
 *
 * Supports multiple providers via the LLM_PROVIDER env var:
 *   - 'gemini'  (default) — Google Gemini 2.5 Flash (free tier)
 *   - 'claude'  — Anthropic Claude Haiku (paid)
 *   - 'openai'  — OpenAI GPT-4o-mini (paid)
 *
 * Switching providers requires only changing the env var + API key.
 * Zero code changes needed.
 */

export interface ParsedFilters {
  roles?: string[]
  positions?: string[]
  gender?: string
  min_age?: number
  max_age?: number
  eu_passport?: boolean
  nationalities?: string[]
  locations?: string[]
  availability?: string
  min_references?: number
  min_career_entries?: number
  leagues?: string[]
  countries?: string[]
  coach_specializations?: string[]
  text_query?: string
  sort_by?: string
  summary?: string
}

export interface SearchIntent {
  type: 'search'
  filters: ParsedFilters
  message: string
  include_qualitative?: boolean
}

export interface ConversationIntent {
  type: 'conversation'
  message: string
}

export interface KnowledgeIntent {
  type: 'knowledge'
  message: string
}

export type LLMResult = SearchIntent | ConversationIntent | KnowledgeIntent

export class LLMRateLimitError extends Error {
  constructor() {
    super('AI_RATE_LIMIT')
    this.name = 'LLMRateLimitError'
  }
}

export class LLMTimeoutError extends Error {
  constructor() {
    super('AI_TIMEOUT')
    this.name = 'LLMTimeoutError'
  }
}

export interface LLMUsage {
  prompt_tokens: number | null
  completion_tokens: number | null
  cached_tokens: number | null
}

export interface LLMCallMeta {
  retry_count: number
  usage: LLMUsage | null
}

/**
 * Version tag for SYSTEM_PROMPT + tool schemas. Bump whenever the prompt text
 * or tool parameters materially change. Logged on every discovery_event so
 * quality/latency comparisons across prompt iterations don't require git
 * archaeology.
 */
export const PROMPT_VERSION = '2026-04-24.1'

const EMPTY_META: LLMCallMeta = { retry_count: 0, usage: null }

// ─── HTTP reliability helpers ──────────────────────────────────────────

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504
}

function jitteredDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * (baseMs / 2))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch wrapper enforcing a per-attempt timeout plus retries on transient
 * failures. Retries: AbortError/TimeoutError (signal timeout), network errors,
 * HTTP 502/503/504. Does NOT retry HTTP 429 (provider quota — caller maps it
 * to LLMRateLimitError which is handled upstream) or HTTP 4xx (won't succeed
 * on retry).
 *
 * On final timeout throws LLMTimeoutError. Other errors propagate unchanged.
 * Returns the successful Response plus the count of retries actually taken
 * (0 when the first attempt succeeded).
 */
async function retryableFetch(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; maxRetries: number; baseBackoffMs?: number }
): Promise<{ response: Response; retryCount: number }> {
  const { timeoutMs, maxRetries, baseBackoffMs = 300 } = opts
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok && isTransientStatus(response.status) && attempt < maxRetries) {
        // Drain the body so the underlying connection can be reused.
        await response.text().catch(() => null)
        await sleep(jitteredDelay(baseBackoffMs))
        continue
      }
      return { response, retryCount: attempt }
    } catch (err) {
      lastError = err
      const isTimeout = err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      if (attempt < maxRetries) {
        await sleep(jitteredDelay(baseBackoffMs))
        continue
      }
      if (isTimeout) throw new LLMTimeoutError()
      throw err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('retryableFetch exhausted retries')
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface UserContext {
  role: string
  full_name: string | null
  gender: string | null
  position: string | null
  base_city: string | null
  base_country_name: string | null
  nationality_name: string | null
  nationality2_name: string | null
  current_club: string | null
  current_league: string | null
  league_country: string | null
  eu_passport: boolean
  open_to_play: boolean
  open_to_coach: boolean
}

function buildUserContextBlock(ctx: UserContext): string {
  const lines: string[] = ['CURRENT USER CONTEXT:']

  const roleName = ctx.role === 'club' ? 'club representative' : ctx.role
  lines.push(`- You are speaking with ${ctx.full_name || 'a user'}, a ${roleName} on HOCKIA.`)

  if (ctx.current_club) {
    const parts = [ctx.current_club]
    if (ctx.current_league) parts.push(ctx.current_league)
    if (ctx.league_country) parts.push(ctx.league_country)
    lines.push(`- Club: ${parts.join(', ')}`)
  }

  const location = [ctx.base_city, ctx.base_country_name].filter(Boolean).join(', ')
  if (location) lines.push(`- Based in: ${location}`)

  const nationalities = [ctx.nationality_name, ctx.nationality2_name].filter(Boolean)
  if (nationalities.length) lines.push(`- Nationality: ${nationalities.join(' & ')}`)

  if (ctx.gender) lines.push(`- Gender context: ${ctx.gender}`)
  lines.push(`- EU passport: ${ctx.eu_passport ? 'Yes' : 'No'}`)

  if (ctx.position) lines.push(`- Position: ${ctx.position}`)

  const availability = []
  if (ctx.open_to_play) availability.push('open to play')
  if (ctx.open_to_coach) availability.push('open to coach')
  if (availability.length) lines.push(`- Availability: ${availability.join(', ')}`)

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are HOCKIA Assistant, a friendly and knowledgeable AI for HOCKIA — a field hockey platform connecting players, coaches, clubs, brands, and umpires. You are also a field hockey expert.

You have three tools:
1. search_profiles — Use when the user wants to find or discover people/profiles. Extract structured filters from their query. Always include a conversational "message" field describing what you're looking for.
2. answer_hockey_question — Use when the user asks about field hockey knowledge: rules, positions, tactics, formations, tournament formats (Olympics, World Cup, Pro League, EHL), FIH regulations, equipment (sticks, goalkeeping gear, balls, turf types), hockey history, training concepts, terminology (drag flick, aerial, jab tackle, penalty corner, etc.), or differences between indoor and outdoor hockey. Provide accurate, helpful answers. You can be detailed (multiple paragraphs) when the question warrants it.
3. respond — Use for greetings, questions about HOCKIA the platform, help requests, or anything that is NOT a profile search and NOT a hockey knowledge question. Be warm and helpful. Mention that you can help discover players, coaches, clubs, brands, and umpires, AND answer field hockey questions.

TOOL SELECTION RULES:
- "Find defenders" or "best players in England" → search_profiles (looking for people)
- "What does a defender do?" or "rules of penalty corner" → answer_hockey_question (hockey knowledge)
- "Hi" or "What is HOCKIA?" → respond (greeting or platform question)
- For medical/injury advice, say you'd recommend consulting a sports medicine professional.
- For non-hockey, non-HOCKIA topics (weather, coding, cooking, etc.), politely redirect: you're a field hockey assistant and can help with hockey questions or discovering profiles.

FILTER EXTRACTION RULES (for search_profiles only):
- Only extract information explicitly stated or clearly implied in the query.
- For age: "U21" means max_age=20, "U18" means max_age=17, "U23" means max_age=22. "Senior" means min_age=21.
- For positions: use exactly "goalkeeper", "defender", "midfielder", or "forward" for players.
- For coach specializations: use "head_coach", "assistant_coach", "goalkeeper_coach", "youth_coach", "strength_conditioning", "performance_analyst", "sports_scientist", or "other". Map natural language like "S&C coach" → "strength_conditioning", "video analyst" → "performance_analyst", "GK coach" → "goalkeeper_coach". Set roles=["coach"] when a specialization is used.
- For gender: use "Men" or "Women" exactly (capital first letter).
- "EU passport" means eu_passport=true. Do NOT list individual EU countries unless the user specifically names them.
- "Open to play", "available", or "looking for opportunities" means availability="open_to_play".
- "Verified references" or "references" maps to min_references.
- If role is not specified, infer from context: positions like "defender" imply role=["player"]; "head coach" implies role=["coach"]; "club" or "team" implies role=["club"]; "brand" or "sponsor" implies role=["brand"]; "umpire", "official", or "referee" implies role=["umpire"].
- IMPORTANT — umpires are ONLY surfaced when the user explicitly asks for them (with words like "umpire", "umpires", "official", "officials", "referee", "referees"). Never volunteer umpires in searches for players, coaches, clubs, or brands. When the intent is unclear, default to NOT including "umpire" in roles.
- For "playing in [country]" or "based in [country]", use the countries array for league/club country context, and locations for where they live.
- When the user mentions "good feedback", "strong references", "well-regarded", "reputation", "endorsed", "reviewed", "testimonials", "comments about", or any qualitative assessment, set include_qualitative=true. This triggers a deeper analysis of profile comments and endorsements for the top results.
- Always generate a human-readable summary field.

CONVERSATION CONTEXT:
When the user refers to previous results or modifies a previous search (e.g., "narrow that down", "show only defenders", "what about in England?"), interpret their request in context of the conversation history. Carry forward relevant filters from the previous search and apply the user's modifications.

USER CONTEXT AWARENESS:
- You know who you're speaking with. Their profile details appear at the end of this prompt under "CURRENT USER CONTEXT". Use it to give smarter, personalized answers.
- When a coach or club asks "recommend players for my team", "who could fit my club", or similar, use their club's league, country, and gender context to infer relevant filters (e.g., set gender to match their league context).
- IMPORTANT — field hockey recruitment is global:
  - Always consider BOTH local players (same country/league) AND international players who could relocate. Do NOT over-filter by location.
  - EU passport eligibility is a critical factor in European recruitment. When searching for a European club, highlight EU-eligible players but don't exclude non-EU players entirely.
  - Mention the global nature of recruitment when relevant (e.g., "I found players in England and some international options from Argentina and the Netherlands who could also be a fit").
- When the user says "my league", "my club", "my team", or "nearby", resolve those from their CURRENT USER CONTEXT.
- The user's gender context tells you whether to filter by "Men" or "Women" when they don't specify.
- If no user context is provided, behave generically as before.`

const SEARCH_TOOL = {
  name: 'search_profiles',
  description: 'Search HOCKIA profiles with structured filters extracted from natural language.',
  input_schema: {
    type: 'object',
    properties: {
      roles: {
        type: 'array',
        items: { type: 'string', enum: ['player', 'coach', 'club', 'brand', 'umpire'] },
        description: 'Profile roles to search. Only include "umpire" when the user explicitly asks for umpires, officials, or referees — never volunteer it for generic searches.',
      },
      positions: {
        type: 'array',
        items: { type: 'string', enum: ['goalkeeper', 'defender', 'midfielder', 'forward', 'head coach', 'assistant coach', 'youth coach'] },
        description: 'Playing positions or coaching roles to filter by.',
      },
      gender: {
        type: 'string',
        enum: ['Men', 'Women'],
        description: 'Gender filter. Only set if explicitly mentioned.',
      },
      min_age: { type: 'integer', description: 'Minimum age in years.' },
      max_age: { type: 'integer', description: 'Maximum age. U21=20, U18=17, U23=22.' },
      eu_passport: { type: 'boolean', description: 'True if user asks for EU passport holders.' },
      nationalities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Country names for nationality filter (e.g. ["Netherlands", "Argentina"]).',
      },
      locations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Country or city names for base location (e.g. ["UK", "London"]).',
      },
      availability: {
        type: 'string',
        enum: ['open_to_play', 'open_to_coach', 'open_to_opportunities'],
        description: 'Availability filter.',
      },
      min_references: { type: 'integer', description: 'Minimum number of accepted references.' },
      min_career_entries: { type: 'integer', description: 'Minimum career history entries.' },
      leagues: {
        type: 'array',
        items: { type: 'string' },
        description: 'League names (e.g. ["Premier Division", "Hoofdklasse"]).',
      },
      countries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Country names where clubs/leagues are based (for "playing in X" queries).',
      },
      coach_specializations: {
        type: 'array',
        items: { type: 'string', enum: ['head_coach', 'assistant_coach', 'goalkeeper_coach', 'youth_coach', 'strength_conditioning', 'performance_analyst', 'sports_scientist', 'other'] },
        description: 'Coach specialization filter. Use when searching for specific types of coaches (e.g., "find me an S&C coach" → ["strength_conditioning"]).',
      },
      text_query: {
        type: 'string',
        description: 'Fallback free-text search for names or terms not covered by structured filters.',
      },
      sort_by: {
        type: 'string',
        enum: ['relevance', 'newest', 'most_referenced', 'recently_active'],
        description: 'Sort order. Default: relevance.',
      },
      summary: {
        type: 'string',
        description: 'Human-readable summary of the search, e.g. "Showing U21 female defenders with EU passport and 2+ references."',
      },
      message: {
        type: 'string',
        description: 'A conversational message about the search, e.g. "Here are the U21 female defenders I found for you!" Keep it to 1-2 sentences.',
      },
      include_qualitative: {
        type: 'boolean',
        description: 'Set to true when the user asks about reputation, feedback, references, endorsements, reviews, comments, or qualitative assessment of profiles.',
      },
    },
    required: ['message', 'summary'],
  },
}

const RESPOND_TOOL = {
  name: 'respond',
  description: 'Respond conversationally when the user is not searching for profiles and not asking a hockey knowledge question. Use for greetings, questions about HOCKIA the platform, or off-topic redirects.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'A friendly, helpful response to the user. Keep it concise (1-2 sentences).',
      },
    },
    required: ['message'],
  },
}

const HOCKEY_KNOWLEDGE_TOOL = {
  name: 'answer_hockey_question',
  description: 'Answer field hockey knowledge questions: rules, positions, tactics, formations, tournaments, FIH regulations, equipment, history, training, terminology, indoor vs outdoor hockey. Use when the user asks about the sport itself, NOT when searching for profiles.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'An accurate, helpful answer about field hockey. Can be detailed — use multiple paragraphs when the question warrants depth. Write in plain conversational text (no markdown). Use numbered lists for rules or steps.',
      },
    },
    required: ['message'],
  },
}

const DEFAULT_CONVERSATION_RESPONSE = "Hey! I'm HOCKIA Assistant. I can help you discover players, coaches, clubs, and brands. Try asking something like 'Find U25 midfielders from the Netherlands'."

// ─── Gemini (Google AI Studio — free tier) ────────────────────────────

async function callGemini(query: string, history: HistoryTurn[] = [], userContext?: UserContext): Promise<{ result: LLMResult; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const systemPrompt = userContext
    ? SYSTEM_PROMPT + '\n\n' + buildUserContextBlock(userContext)
    : SYSTEM_PROMPT

  const contents = [
    ...history.map(turn => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    { role: 'user', parts: [{ text: query }] },
  ]

  const { response, retryCount } = await retryableFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{
          function_declarations: [
            { name: SEARCH_TOOL.name, description: SEARCH_TOOL.description, parameters: SEARCH_TOOL.input_schema },
            { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, parameters: RESPOND_TOOL.input_schema },
            { name: HOCKEY_KNOWLEDGE_TOOL.name, description: HOCKEY_KNOWLEDGE_TOOL.description, parameters: HOCKEY_KNOWLEDGE_TOOL.input_schema },
          ],
        }],
        tool_config: { function_calling_config: { mode: 'ANY' } },
      }),
    },
    { timeoutMs: 4000, maxRetries: 1 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 503) {
      throw new LLMRateLimitError()
    }
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    cached_tokens: data.usageMetadata?.cachedContentTokenCount ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const candidate = data.candidates?.[0]
  const parts = candidate?.content?.parts

  if (!parts) throw new Error('Gemini returned no content')

  const fnCall = parts.find((p: any) => p.functionCall)
  if (!fnCall?.functionCall?.args) {
    throw new Error('Gemini did not produce a function call')
  }

  const { name, args } = fnCall.functionCall
  if (name === 'respond') {
    return { result: { type: 'conversation', message: args.message || DEFAULT_CONVERSATION_RESPONSE }, meta }
  }
  if (name === 'answer_hockey_question') {
    return { result: { type: 'knowledge', message: args.message || "I couldn't generate an answer. Try rephrasing your question." }, meta }
  }

  const { message, include_qualitative, ...filters } = args
  return {
    result: { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true },
    meta,
  }
}

// ─── Claude (Anthropic — paid) ────────────────────────────────────────

async function callClaude(query: string, history: HistoryTurn[] = [], userContext?: UserContext): Promise<LLMResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const systemPrompt = userContext
    ? SYSTEM_PROMPT + '\n\n' + buildUserContextBlock(userContext)
    : SYSTEM_PROMPT

  const messages = [
    ...history.map(turn => ({ role: turn.role as 'user' | 'assistant', content: turn.content })),
    { role: 'user' as const, content: query },
  ]

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      tools: [
        { name: SEARCH_TOOL.name, description: SEARCH_TOOL.description, input_schema: SEARCH_TOOL.input_schema },
        { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, input_schema: RESPOND_TOOL.input_schema },
        { name: HOCKEY_KNOWLEDGE_TOOL.name, description: HOCKEY_KNOWLEDGE_TOOL.description, input_schema: HOCKEY_KNOWLEDGE_TOOL.input_schema },
      ],
      tool_choice: { type: 'auto' },
      messages,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Claude API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const toolUse = data.content?.find((c: any) => c.type === 'tool_use')

  if (!toolUse?.input) {
    const textBlock = data.content?.find((c: any) => c.type === 'text')
    return { type: 'conversation', message: textBlock?.text || DEFAULT_CONVERSATION_RESPONSE }
  }

  if (toolUse.name === 'respond') {
    return { type: 'conversation', message: toolUse.input.message || DEFAULT_CONVERSATION_RESPONSE }
  }
  if (toolUse.name === 'answer_hockey_question') {
    return { type: 'knowledge', message: toolUse.input.message || 'I couldn\'t generate an answer. Try rephrasing your question.' }
  }

  const { message, include_qualitative, ...filters } = toolUse.input
  return { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true }
}

// ─── OpenAI (paid) ─────────────────────────────────────────────────────

async function callOpenAI(query: string, history: HistoryTurn[] = [], userContext?: UserContext): Promise<LLMResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const systemPrompt = userContext
    ? SYSTEM_PROMPT + '\n\n' + buildUserContextBlock(userContext)
    : SYSTEM_PROMPT

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map(turn => ({ role: turn.role as 'user' | 'assistant', content: turn.content })),
    { role: 'user' as const, content: query },
  ]

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      tools: [
        { type: 'function', function: { name: SEARCH_TOOL.name, description: SEARCH_TOOL.description, parameters: SEARCH_TOOL.input_schema } },
        { type: 'function', function: { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, parameters: RESPOND_TOOL.input_schema } },
        { type: 'function', function: { name: HOCKEY_KNOWLEDGE_TOOL.name, description: HOCKEY_KNOWLEDGE_TOOL.description, parameters: HOCKEY_KNOWLEDGE_TOOL.input_schema } },
      ],
      tool_choice: 'auto',
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]

  if (!toolCall?.function) {
    const content = data.choices?.[0]?.message?.content
    return { type: 'conversation', message: content || DEFAULT_CONVERSATION_RESPONSE }
  }

  const args = JSON.parse(toolCall.function.arguments)
  if (toolCall.function.name === 'respond') {
    return { type: 'conversation', message: args.message || DEFAULT_CONVERSATION_RESPONSE }
  }
  if (toolCall.function.name === 'answer_hockey_question') {
    return { type: 'knowledge', message: args.message || 'I couldn\'t generate an answer. Try rephrasing your question.' }
  }

  const { message, include_qualitative, ...filters } = args
  return { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true }
}

// ─── Provider dispatcher ───────────────────────────────────────────────

export async function parseSearchQuery(query: string, history: HistoryTurn[] = [], userContext?: UserContext): Promise<{ result: LLMResult; meta: LLMCallMeta }> {
  const provider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  switch (provider) {
    case 'gemini':  return callGemini(query, history, userContext)
    case 'claude':  return { result: await callClaude(query, history, userContext), meta: EMPTY_META }
    case 'openai':  return { result: await callOpenAI(query, history, userContext), meta: EMPTY_META }
    default:        return callGemini(query, history, userContext)
  }
}

// ─── Qualitative synthesis (second LLM pass) ─────────────────────────

export interface ProfileQualitativeData {
  profile_id: string
  full_name: string | null
  role: string
  position: string | null
  comments: Array<{
    content: string
    rating: string
    author_name: string | null
    author_role: string | null
  }>
  references: Array<{
    endorsement_text: string | null
    relationship_type: string
    endorser_name: string | null
    endorser_role: string | null
  }>
}

const SYNTHESIS_SYSTEM_PROMPT = `You are HOCKIA Assistant analyzing reputation data for field hockey profiles. You will receive profile names with their comments and references. Synthesize this into a brief, helpful summary for someone evaluating these profiles.

RULES:
- Be concise: 1-2 sentences per profile, max.
- Focus on patterns: if multiple comments mention the same quality, highlight it.
- Distinguish between comments (public feedback from anyone) and references (trusted endorsements from connections).
- If a profile has no comments or references, say so briefly.
- Use a warm, professional tone. Do not fabricate or exaggerate.
- Do not use bullet points. Write flowing prose.
- Start with a brief intro like "Here's what the community says about these profiles:" then cover each person.`

function buildSynthesisUserMessage(profiles: ProfileQualitativeData[], userQuery: string): string {
  const sections = profiles.map(p => {
    const name = p.full_name || 'Unknown'
    const pos = p.position ? ` (${p.position})` : ''
    let section = `### ${name} — ${p.role}${pos}\n`

    if (p.comments.length > 0) {
      section += `Comments (${p.comments.length}):\n`
      section += p.comments.map(c =>
        `- [${c.rating}] "${c.content}" — ${c.author_name || 'Anonymous'} (${c.author_role || 'member'})`
      ).join('\n') + '\n'
    } else {
      section += 'No comments yet.\n'
    }

    if (p.references.length > 0) {
      section += `Trusted References (${p.references.length}):\n`
      section += p.references.map(r =>
        `- "${r.endorsement_text || '(no text)'}" — ${r.endorser_name || 'Anonymous'} (${r.endorser_role || 'member'}, ${r.relationship_type})`
      ).join('\n') + '\n'
    } else {
      section += 'No trusted references yet.\n'
    }

    return section
  }).join('\n')

  return `The user asked: "${userQuery}"\n\nReputation data for the top ${profiles.length} results:\n\n${sections}\n\nPlease synthesize these reputation signals concisely.`
}

async function synthesizeWithGemini(profiles: ProfileQualitativeData[], userQuery: string): Promise<{ text: string; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const { response, retryCount } = await retryableFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYNTHESIS_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildSynthesisUserMessage(profiles, userQuery) }] }],
      }),
    },
    { timeoutMs: 3000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 503) {
      throw new LLMRateLimitError()
    }
    throw new Error(`Gemini synthesis error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    cached_tokens: data.usageMetadata?.cachedContentTokenCount ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return { text, meta }
}

async function synthesizeWithClaude(profiles: ProfileQualitativeData[], userQuery: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYNTHESIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildSynthesisUserMessage(profiles, userQuery) }],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Claude synthesis error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const textBlock = data.content?.find((c: any) => c.type === 'text')
  return textBlock?.text || ''
}

async function synthesizeWithOpenAI(profiles: ProfileQualitativeData[], userQuery: string): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 512,
      messages: [
        { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
        { role: 'user', content: buildSynthesisUserMessage(profiles, userQuery) },
      ],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI synthesis error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

export async function synthesizeQualitativeInsights(
  profiles: ProfileQualitativeData[],
  userQuery: string
): Promise<{ text: string; meta: LLMCallMeta }> {
  const provider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  switch (provider) {
    case 'gemini':  return synthesizeWithGemini(profiles, userQuery)
    case 'claude':  return { text: await synthesizeWithClaude(profiles, userQuery), meta: EMPTY_META }
    case 'openai':  return { text: await synthesizeWithOpenAI(profiles, userQuery), meta: EMPTY_META }
    default:        return synthesizeWithGemini(profiles, userQuery)
  }
}
